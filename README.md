# zeno-console

Zeno Console is a web app for the Zeno L2 on Zenon. Anyone reads domains, batches, contracts and receipts without a wallet. Connect a browser wallet to deploy, upgrade, call and manage WASM contracts, relay withdrawals and administer Settlement.

The app is built on [nom-ui](https://github.com/digitalSloth/nom-ui), `znn-typescript-sdk` and `zeno-client`. It holds no keys and loads the wallet adapter only when you connect. See `AGENTS.md` for the layout and commands. Common questions are answered in [docs/faq.md](docs/faq.md).

## What the console does

| Page | What it covers |
|---|---|
| Dashboard | The L1 height, the domain count, inputs received and paused domains across the network, and a card per domain |
| Network | Pause state, domains, prices, pending time challenges, executors and fees, custody |
| Domain | One domain's pages, picked in the sidebar: Overview (heads, latest batches and inputs, gateway, custody), Batches, Inputs, Events, Outbox and Contracts |
| Contracts | A verified overview, call, state, events, activity, manage (with a wallet) and the interface file |
| Deploy | Load a module, configure, review the plan and fees, send each chunk through the wallet, resume after a reload, upgrade |
| Withdrawals | Your outbox withdrawals per domain, relay with a proof check, release (with a wallet) |
| Admin | Pause and resume, and every time-challenged administrator change, for the configured administrator |
| Playground | Send one raw `zeno_*` request to the gateway, unverified |
| Send tracker | One send from publish to finalized receipt |

Every L2 value carries a verification badge: Verified (proofs checked against the Settlement batch root), Pending, or Inconsistent.

## Run

```bash
npm install
npm run dev
```

The console needs a znnd node with the Settlement spork active (default `ws://localhost:35998`) and a gateway (default `http://127.0.0.1:35999`). Both are set in the app.
