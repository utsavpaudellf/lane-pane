# Install lane-pane

lane-pane shows the LANE dashboard as a pane in Claude Code: the next step, the human gates waiting on you, progress, features, and recent activity.

## Before you start

You need all three:

1. Claude Code v2.1.287 or later. Check with `claude --version`. The Claude Desktop app needs v2.1.286 or later: type `/status` in a Code session and read the "Claude Code" row.
2. The `lane` CLI on your `PATH`. Check with `lane --version`.
3. A repo set up with `lane init`.

## Option A: install from GitHub (recommended)

This works in the terminal and in the Desktop app. The repository is public, so you do not need a GitHub login.

1. Register the repository as a marketplace:

   ```bash
   claude plugin marketplace add utsavpaudellf/lane-pane
   ```

   You see: `Successfully added marketplace: lane-mods`.

2. Install the plugin:

   ```bash
   claude plugin install lane-pane@lane-mods
   ```

3. Start a new Claude Code session. In an open session, run `/reload-plugins` instead.

To get a new version later, run `claude plugin marketplace update lane-mods`, then `claude plugin update lane-pane@lane-mods`, then start a new session.

## Option B: install from the zip file

Use this when you want a local copy instead of the GitHub marketplace. Download [lane-pane-0.3.3.zip](https://github.com/utsavpaudellf/lane-pane/releases/download/v0.3.3/lane-pane-0.3.3.zip) from the [v0.3.3 release](https://github.com/utsavpaudellf/lane-pane/releases/tag/v0.3.3).

1. Unzip the file to a folder you will keep. The plugin stays where you unzip it, so do not unzip it to Downloads or a temp folder.

   ```bash
   mkdir -p ~/mods && unzip lane-pane-0.3.3.zip -d ~/mods
   ```

2. Register the folder as a marketplace:

   ```bash
   claude plugin marketplace add ~/mods/lane-pane
   ```

   You see: `Successfully added marketplace: lane-mods`.

3. Install the plugin:

   ```bash
   claude plugin install lane-pane@lane-mods
   ```

   You see: `Successfully installed plugin: lane-pane@lane-mods`.

4. Start a new Claude Code session. Sessions that were already open do not load it. In an open session, run `/reload-plugins` instead.

## Option C: try it for one session

Run Claude Code with the zip file. Nothing is installed.

```bash
claude --plugin-dir ./lane-pane-0.3.3.zip
```

## Use it

1. In a Claude Code session, type `/lane-pane` and press Enter. The pane opens for the lane repo that holds the session's folder. If the session's folder is one level above a lane repo, it opens that repo. If it finds several, it lists them, and you pick one with `/lane-pane <path>`.
2. To show another lane repo, type `/lane-pane /path/to/repo`.
3. To close the pane, type `/lane-pane` again, or close the pane.
4. To decide a gate, press **Review** under "Waiting on you". Read the document, then press **Approve** twice, or type a note and press **Request changes**, or press **Reject**.

When it works, the pane shows the repo name, a "live" dot, and the next lane step.

In the terminal, the pane sits above the prompt. To put it beside the conversation, type `/tui fullscreen` once. Your terminal must be 110 or more columns wide. To go back, type `/tui default`.

## Troubleshooting

- **"Unknown command: /lane-pane"**: the session started before the install. Start a new session, or run `/reload-plugins`.
- **The pane shows "could not start lane dashboard"**: the `lane` CLI is not on your `PATH`. Install it, then open the pane again.
- **The pane shows "not a LANE repo"**: the folder is not a lane repo. Run `/lane-pane /path/to/your/lane/repo`, or run `lane init` in that repo.

## Update or remove

- To update: unzip the new version over the old folder, then start a new session.
- To remove:

  ```bash
  claude plugin uninstall lane-pane@lane-mods
  claude plugin marketplace remove lane-mods
  ```

## What it does on your machine

- It starts `lane dashboard --no-open` in the repo and reads its local API (`http://127.0.0.1:<port>/api/state`) every 2 seconds.
- It does not send data anywhere else.
- It stops the dashboard when you close the pane.
- It sends a gate decision only when you press a button: **Approve** (two presses), **Request changes** (needs a note), or **Reject**. lane checks the dashboard's session token and the sha256 of the text you read, then writes the stamp and the commit itself. Request changes and Reject never stamp anything.
