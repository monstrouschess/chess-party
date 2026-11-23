# Chess Party ♞

Play chess with a friend in the browser, either on the same screen or online with a 5-character party code.

## Run it on your own computer

1. Open PowerShell in this folder.
2. The first time only, run `npm install`.
3. Run `npm start`.
4. Open http://localhost:3000.

To play online with a friend on another computer, the site has to be on the internet (see below).

## Put it online for free (Render)

You need a free GitHub account and a free Render account. It takes about 10 minutes.

1. **Put the code on GitHub**
   - Go to https://github.com/new, name the repo `chess-party`, and click **Create repository**.
   - On the next page, click **uploading an existing file**.
   - Drag in everything from this folder **except** the `node_modules` folder, then click **Commit changes**.
2. **Create the website on Render**
   - Go to https://render.com and sign up with your GitHub account.
   - Click **New +** → **Web Service**, then pick your `chess-party` repo.
   - Fill in:
     - Runtime: **Node**
     - Build command: `npm install`
     - Start command: `npm start`
     - Instance type: **Free**
   - Click **Deploy**. After a few minutes you'll get a link like `https://chess-party-xxxx.onrender.com`.
3. **Play.** Open the link, click **Create party**, and send your friend the code or the invite link.

### Things to know about the free plan
- If nobody has used the site for about 15 minutes, it goes to sleep. The next visit takes up to about a minute to wake it up, so just wait for it to load.
- Party codes are kept in memory. If the site sleeps or restarts, old codes stop working, so just make a new party.

## How it works
- `server.js` is a small Node server. It serves the website and passes moves between the two players over a WebSocket. It also checks every move, so nobody can cheat by editing the page.
- `public/` holds the website: the board, premoves, arrows, sounds and so on.
- The chess rules come from [chess.js](https://github.com/jhlywa/chess.js).
- The piece pictures are the "cburnett" set by Colin M.L. Burnett (CC BY-SA 3.0).
