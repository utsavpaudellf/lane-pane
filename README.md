# lane-pane

A Claude Code mod that shows the LANE dashboard as a pane: the next step, human gates waiting on you, the current feature's progress, all features, and recent activity. It works in the terminal and in the Code tab of the Claude Desktop app.

Each gate waiting on you has a **Review** button. It shows the gate's document with **Approve**, **Request changes**, and **Reject**. Approve needs two presses. It sends the dashboard's session token and the sha256 of the text you read, so lane refuses the approval if the document changed after you read it.

## Requirements

- Claude Code v2.1.287 or later (Desktop app: v2.1.286 or later)
- The `lane` or `lane-lite` CLI on your `PATH` (it tries `lane` first)
- A repo set up with `lane init`

## Install

See [INSTALL.md](INSTALL.md).

## Use

- `/lane-pane` opens the pane for the lane repo that holds the session's folder, or for the one lane repo directly below it. Run it again to close the pane.
- `/lane-pane <path>` opens the pane for another lane repo, or switches the pane to it.

The pane starts `lane dashboard --no-open` (or `lane-lite dashboard --no-open`) in the background and reads its `/api/state` every 2 seconds. Closing the pane stops that process.

In the terminal, the pane sits above the prompt. To dock it beside the transcript, run `/tui fullscreen` (needs 110 or more columns).

## Develop

```bash
claude plugin validate .
claude plugin test .
```
