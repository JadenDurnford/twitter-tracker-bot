import express from "express";
import pg from "pg";
import axios from "axios";
import cron from "node-cron";
import {Client, Intents, TextChannel} from "discord.js";

// Connect to the database using the DATABASE_URL environment
//   variable injected by Railway
const pool = new pg.Pool();

const app = express();
const port = process.env.PORT || 3333;
const params = {
  "user.fields": "public_metrics",
};

const token = process.env.token;
const authToken = process.env.authToken;
const channelId = process.env.channelId!;
const userId = process.env.userId;

if (!channelId || !userId) {
  console.log("missing var");
  process.exit(1);
}

const client = new Client({ intents: [Intents.FLAGS.GUILDS] });
client.login(authToken);

axios.defaults.headers.get['authorization'] = `Bearer ${token}`;

cron.schedule('*/1 * * * *', async () => {
  const channel = await client.channels.fetch(channelId);
  const usersCount = await pool.query("SELECT COUNT(username) FROM userstracked");

  if (usersCount.rows[0].count == 0) {
    console.log("no accounts to track");
    process.exit(1);
  }

  const user = await pool.query("SELECT username FROM userstracked");
  const username = [`${user.rows[0].username}`];
  for (let k = 1; k < usersCount.rows[0].count; k++) {
    username.push(`${user.rows[k].username}`);
  }
  for (let i = 0; i < username.length; i++) {
    const endpointURL = `https://api.twitter.com/2/users/by/username/${username[i]}`;
    const response = await axios.get(endpointURL, {params});
    const {rows} = await pool.query(`SELECT COUNT(username) FROM twitterdata WHERE username = '${response.data.data.username}'`);
    if (rows[0].count == 1) {
      const following = await pool.query(`SELECT following FROM twitterdata WHERE username = '${username[i]}'`);
      
      if (following.rows[0].following < response.data.data.public_metrics.following_count) {
        const numberNew = response.data.data.public_metrics.following_count - following.rows[0].following;

        for (let j = 0; j < numberNew; j++) {
          const id = await pool.query(`SELECT twitterid FROM twitterdata WHERE username = '${username[i]}'`);
          const newFollow = await axios.get(`https://api.twitter.com/2/users/${id.rows[0].twitterid}/following?max_results=${j+1}`);

          console.log(`${username[i]} just followed ${newFollow.data.data[j].username}`);
        
          (channel as TextChannel).send(`<@${userId}> ${username[i]} just followed https://twitter.com/${newFollow.data.data[j].username}`);
          await pool.query(`INSERT INTO usersfollowed (username, followedby) VALUES ('${newFollow.data.data[j].username}', '${username[i]}')`);
        }

        await pool.query(`UPDATE twitterdata SET following = ${response.data.data.public_metrics.following_count} WHERE username = '${username[i]}'`);

      } else if (following.rows[0].following > response.data.data.public_metrics.following_count) {
        await pool.query(`UPDATE twitterdata SET following = ${response.data.data.public_metrics.following_count} WHERE username = '${username[i]}'`);
      }

    } else {
      await pool.query(`INSERT INTO twitterdata (username, following, twitterid) VALUES ('${response.data.data.username}', ${response.data.data.public_metrics.following_count}, '${response.data.data.id}')`)

      console.log(`Added new Twitter user: ${response.data.data.username}`);

      (channel as TextChannel).send(`<@${userId}> https://twitter.com/${response.data.data.username} is now being tracked`);
    }
  } 
}); 

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});