# ZaloDesk CLI

Your [ZaloDesk](https://zalodesk.com) inbox from the terminal: read and send Zalo and Zalo OA
messages, look up contacts, and manage who on your team sees which Zalo (Phân quyền) and who
gets new chats and calls.

```sh
npm install -g zalodesk
zalodesk login
zalodesk list-accounts
```

Or without installing: `npx zalodesk login`.

`login` opens the browser to sign in with your ZaloDesk account. Commands run as you, with your
ZaloDesk permissions. Personal Zalo accounts answer while the ZaloDesk desktop app that holds
them is on; Zalo OA accounts always answer.

## Commands

```sh
zalodesk tools                  # every command
zalodesk <command> --help       # its options
zalodesk <command> --option value [--json '{...}']
```

Inbox

| Command | |
| --- | --- |
| `list-accounts` | Zalo and Zalo OA accounts you can use |
| `list-conversations` | Conversations of an account |
| `read-messages` | Messages of a conversation |
| `search-messages` | Search messages |
| `send-message` | Send a text message |
| `mark-read` | Mark a conversation read |
| `find-contact-by-phone` | Find a Zalo user by phone number |
| `list-friend-requests`, `accept-friend-request` | Friend requests |
| `list-labels`, `set-label` | Conversation labels |

Team (Phân quyền), for the workspace owner

| Command | |
| --- | --- |
| `list-team` | Members, their Zalo, permissions and devices |
| `add-team-member`, `update-team-member`, `remove-team-member` | Change the team |
| `resend-invite` | Send an expired invite again |
| `move-company-zalo`, `remove-company-zalo` | Company Zalo accounts and the PCs that run them |

Routing, for the owner and Quản trị viên

| Command | |
| --- | --- |
| `get-routing`, `update-routing` | Chia khách tự động and calls |
| `assign-conversation` | Give a conversation to someone |
| `list-call-log` | Zalo OA call log |
| `simulate-call` | Thử cuộc gọi: who a call would ring, changing nothing |

Output is JSON, so it pipes into `jq`:

```sh
zalodesk list-conversations --account-id 123 | jq -r '.conversations[].name'
```

## AI agents

The same commands are a remote MCP server at `https://app.zalodesk.com/api/mcp` for Claude,
ChatGPT, Cursor and Hermes Agent ([zalodesk-mcp](https://github.com/zalodesk/zalodesk-mcp)).

## Sign-in

Tokens are kept in `~/.config/zalodesk/auth.json` (readable only by you). `zalodesk logout`
revokes and deletes them.

## License

MIT
