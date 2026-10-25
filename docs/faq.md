# Zeno Console FAQ

Answers for developers who deploy contracts and operators who try a devnet. Values for a local devnet are in the last section.

- [Reading data](#reading-data)
- [Fees and prices](#fees-and-prices)
- [Contracts](#contracts)
- [Setup](#setup)
- [Local devnet](#local-devnet)

## Reading data

### What do Pending, Latest and Finalized mean?

They are the three "Read at" choices on a contract page. Each one names how far a batch has travelled from the executor to Settlement. Latest is the default.

| Choice | The batch it reads | Verified | What happens next |
|---|---|---|---|
| Pending | The newest batch the executor produced, not yet accepted by Settlement | No | Settlement accepts it, or the gateway retracts it |
| Latest | The newest batch Settlement accepted | Yes | It waits out its finality delay |
| Finalized | The newest accepted batch that is past its finality delay | Yes | Nothing, it cannot be undone |

A remote gateway keeps no pending batch. When you pick Pending on one, the console reads at Latest instead and shows "Showing the latest accepted state". The row that reports the batch says which choice answered.

### What do the send tracker states mean?

The `/tx/<hash>` page follows one send from your wallet to a finalized receipt. It has five states, and the first two come from the Zenon node, the last three from the gateway.

| State | Meaning | Read at |
|---|---|---|
| Published | The send block is in your account chain and has no receive block paired yet | none |
| Received | Settlement's contract received the send | none |
| Executed | The gateway has a receipt for the send, and your node confirms its domain and sender, but Settlement has not accepted its batch. The rest of the receipt is unchecked. | Pending |
| Submitted | Settlement accepted the batch, and the console checked the receipt against it | Latest |
| Finalized | The batch passed its finality delay, which is the domain's withdrawal delay, and the console checked the receipt against it again | Finalized |

The tracker reads again every 5 seconds. With a WebSocket gateway, the gateway also pushes changes, so the page updates sooner. If the WebSocket connection drops, the console opens a new one on its next read, and the page keeps reading every 5 seconds. A pending receipt can be withdrawn when the executor replaces its batch, and the tracker then falls back to Received. No step is marked done while the node has no block with that hash.

The console checks each receipt itself, against your node. At Executed it checks that the receipt is for this send, for the domain the send targets and from the account that sent it. At Submitted and Finalized it also checks the receipt against the batch Settlement accepted: the receipt must be in the batch's receipt root, the receipt's input must match the send your node shows, and the return data, events and outbox items must match the receipt. Until a check passes, the page marks each field it has not checked "(unchecked)". When a check fails, the badge shows Inconsistent, a red alert names the failed check, and the page stays at the node's state. When the check cannot finish, for example because your node does not show the batch yet, the badge stays Pending, a notice says why, and the next read checks again. If your node still does not show the send, the batch or its finality 2 minutes after the page first found it missing (reloading the page starts the count again), the check fails: either your node is behind or the gateway's receipt is false, and the page turns Verified as soon as your node catches up. The same limit applies when the gateway does not serve the receipt data for the batch, for example because it answers with an error: after 2 minutes the page shows the check as failed and the receipt cannot be checked. Only a failure to read your own node waits with no limit. While a Finalized receipt waits for your node to report the batch as final, the page treats the receipt as checked at Latest, so only its "read at" tag stays marked "(unchecked)". When you switch to another node, the page checks the receipt again against the new node.

An administrator change, a Pause, a Relay and a Release queue no domain input, so no receipt follows them. Their pages end at Received, show only Published and Received, and say that no receipt follows.

### What is the finality delay for?

It is the one time gate on moving value out of a domain. A batch becomes Finalized at its submission height plus the domain's withdrawal delay, counted in momenta, and Settlement releases a withdrawal only from a finalized batch. Fees wait for it too: an epoch pays out only after every batch in it is finalized.

The delay is a window to notice and react. At the current testnet setting one executor attests to each batch with no proof and no bond, so the protections are the delay, the per-batch withdrawal cap, the rule that Settlement never pays out more than was deposited, and the fact that every commitment is public. If a batch looks wrong, the administrator can pause relaying before anything leaves. Mainnet will not use this setting: it requires a validity proof for every batch, which Settlement verifies when it accepts the batch.

The delay is a per-domain setting that the administrator can change within hard bounds, and a change applies only to batches accepted after it takes effect. A devnet build uses 30 momenta, which is 5 minutes. See Local devnet for the other values.

### How do I read a contract's data?

Open the contract, then the State tab. The tab lists the storage entries that the contract's interface file declares.

- Items (single values) are read as soon as the tab opens.
- Maps need their key fields first. Fill them in and press Read.
- A 32-byte key field accepts hex, a `z1` address or a `zts1` token.
- An entry that does not exist shows "Not set".
- Each read has its own badge, the gateway's verified flag for that read.

A contract must declare its storage in its interface file. Without the file the tab shows "No interface file" and offers a raw local key. A file with no `storage` section shows "No storage entries". Add the file on the Overview tab. `cargo zeno build` writes it as `<name>.interface.json`.

## Fees and prices

### What do fees collected, burned and credited mean?

Fees collected is the ZNN that deploys and storage purchases have paid to Settlement. Burned and credited split those fees after each epoch ends, so both read 0 until the first epoch ends.

| Counter | Meaning |
|---|---|
| Collected | ZNN attached to a deploy finalize, an upgrade or a storage purchase, counted when Settlement receives the send. The Network page shows this one. |
| Burned | The burned share of settled epochs. |
| Credited | The share added to executor pillars' reward deposits. |
| Paid | Credited ZNN that a pillar's reward address has withdrawn. |

Fees are grouped by epoch. An epoch is 8,640 momentums (24 hours) on a mainnet build and 60 momentums (10 minutes) on a devnet build, and a fee belongs to the epoch in which its batch was submitted. An epoch settles only after it has ended and every batch in it is final. Pillars send the permissionless `SettlementUpdate` call, which settles the oldest queued epoch.

On settlement, 30% of each pillar's fees is burned and 70% is credited to the reward deposit of the executor pillar that submitted the batch. If that pillar is not an active pillar at settlement, all of its fees are burned. The pillar's reward address then withdraws its deposit with the collect-reward call. Settlement and collection both wait while relaying is paused.

### Why does the console say "Cannot deploy yet: the bytecode price is not set"?

The Settlement administrator has not set the prices yet, and Settlement rejects every deploy until it does. The administrator sets them in the Admin area ("Set periphery prices"). On a devnet, that is the account listed in the last section.

The change takes two steps, because it is time-challenged:

1. The administrator proposes the prices. The price per byte of bytecode and the price per byte of state are set together.
2. After the minimum soft delay, the administrator sends the same values again. Settlement applies them on that second send.

The Network page shows the open proposal under "Pending time challenges". The soft delay is 8,640 momentums (24 hours) on a mainnet build and 6 momentums (1 minute) on a devnet build. A different value in the second send restarts the delay.

Each price is between 1 base unit and 1 ZNN per byte (ZNN has 8 decimals).

A domain also needs an asset limit for every asset it takes. Settlement refuses a deposit of an asset that has none ("Set an asset limit" in the Admin area, another time-challenged change with the same two steps). The limit caps what a domain's contracts can withdraw of that asset in one batch, so set it high enough for the withdrawals you expect. A refund of a rejected deposit is bounded by that batch's deposits instead. The limit is between 1 and 100,000,000,000,000 base units, and it can be raised but not lowered.

### What does a deploy cost?

A deploy costs the module's size in bytes times the price per byte of bytecode, charged once, in ZNN. A 40,000-byte module at 10 base units per byte costs 400,000 base units (0.004 ZNN).

A deploy is three kinds of send. Start and every Chunk carry no ZNN. Finalize carries the whole fee, and Settlement requires the exact amount. The Deploy page shows the fee in its review step, before the wallet asks you to sign.

A module can be 256 KiB at most and goes out in chunks of up to 15 KiB. A deploy attempt expires 2,880 momentums (8 hours) after its Start, so send the Finalize before then. An upgrade pays the same bytecode fee for the new module.

### Why do I need to buy storage?

A contract writes state only up to the storage you bought for it. Buy storage before the first call that writes. Without it, the call fails with `STORAGE_QUOTA_EXCEEDED` and the runtime refunds the deposit that came with it.

Open the contract, then the Manage tab, find Buy storage, and enter a number of bytes. The fee is that number times the price per byte of state, in ZNN. The Overview tab shows the used and purchased bytes. Anyone can buy storage for any contract.

## Contracts

### What are the reference vault and the counter?

Both are example contracts in `zeno-contract-sdk-rs` under `examples/`. Each has its built `.wasm`, its interface file and its hashes file in an `artifacts/` folder.

The vault is a reference example for contracts that hold funds, and a demo for testnet deposits and withdrawals. It is immutable and has no owner, so nobody can change it after deploy. Its metadata is in `vault.hashes.json`.

- Deposit with the Deposit form on the Manage tab. The vault credits the sender's balance.
- Withdraw with `withdraw(asset, amount, l1_recipient)`. The recipient must be a user address, not a contract address. The all-zero address is refused, and so is a zero amount.
- A malformed asset id is rejected. An asset id is 22 zero bytes followed by the 10-byte token standard.
- Buy storage before the first deposit. A deposit made without storage is refunded in full.

On a public network, deploy only the `vault.*` artifacts and never `vault-testhook.*`, which exists for tests only. A devnet may deploy `vault-testhook` to try a payable call, because `claim_partial` is the only payable method among the examples.

The counter keeps one number and has an `increment` method. `counter-v2` adds `decrement`. The counter artifacts carry no deploy metadata, so you choose the policy at deploy: pick Owner upgradeable on the Deploy page (the owner defaults to the connected address), then use Upgrade on its Manage tab to move it to `counter-v2`. Pick Immutable and it can never change.

### How do withdrawals reach my L1 address?

A withdrawal a contract registers is paid out in three stages, and the Withdrawals page covers the last two. The page shows in the navigation once a wallet is connected, and its domain selector picks the domain whose withdrawals it lists and sends to. The page lists every withdrawal of the domain, newest first. It stops after 100 withdrawals or five gateway pages of the outbox, whichever comes first, and says so below the list. With a wallet connected, "Mine only" is on and lists the withdrawals addressed to the connected address. Turn it off to relay anyone's withdrawal: Relay and Release are permissionless.

1. The batch holding the withdrawal is accepted, then waits for its finality delay (the domain's withdrawal delay).
2. Relay registers the withdrawal with Settlement. It needs the batch to be final. The console checks the inclusion proof against the outbox root Settlement recorded before it sends.
3. Release pays out the queue. It is permissionless and pays up to 16 queued withdrawals per call, at most one call per momentum for the domain.

The executor also relays the withdrawals of a final batch on its own, so a withdrawal can already be queued when you open the page.

The page shows each withdrawal as "Ready to relay", "Queued for release" or "Released". Settlement rejects relays and releases while the administrator has paused relaying, and the page shows "Relaying is paused".

### What does "Test before deploy" do?

It runs your module on your own computer and shows the result. Nothing is sent, nothing is signed, and no wallet is needed. The panel is on the Deploy page.

- It runs in `zeno-exec serve`, a local tool. When the runner does not answer, the panel shows the command that starts it.
- It sends the deploy twice. The first request learns the contract id, and the second replays the deploy, buys 65,536 bytes of storage and runs your steps. Each request starts from empty state, so nothing carries over between runs.
- Amounts are in base units. Add Deposit and Call steps, then press Run.
- It deploys as immutable from a fixed test sender.

Start the runner with `zeno-exec serve`. It listens on `127.0.0.1:8547` and accepts pages from `localhost` and `127.0.0.1`. For a console served from another origin, add the origin:

```bash
zeno-exec serve --allow-origin https://console.example
```

That command already carries the origin of the page you are on. Never expose `zeno-exec serve`: no reverse proxy, port forward or tunnel. It runs any module sent to it on your machine.

## Setup

### How do I set up the wallet and the console?

The console holds no keys. It builds each transaction and asks a browser wallet to sign it, so you need the NoM web wallet extension, which provides `window.zenon`. Without it the header shows "No wallet", and its tooltip asks you to install the wallet and reload.

1. In the `nom-webwallet` checkout, run `npm install`, then `npm run build:extension`.
2. In Chrome or Edge, open `chrome://extensions/`, turn on Developer mode, choose Load unpacked, and select `dist-extension/`.
3. Create or import an account in the wallet.
4. In the wallet, open Settings, then Network. Set the node URL, the Chain ID and the Network ID.
5. In the console, open the network indicator in the header and set the same node, Chain ID and Network ID. Settings holds the gateway URL and the default domain.

The wallet and the console must agree on the chain id and the node. When they differ, the console shows "The wallet is on a different network" and names both values. Both default to chain id 1 and network id 1, so a devnet needs both changed.

After Connect, the console reconnects on its own when the page reloads. After Disconnect, it waits for a click.

### Why does Settlement keep custody, and what does the executor do?

Settlement is an embedded contract on Zenon. It holds every deposited asset, and it checks that what it released plus what is waiting to be released never exceeds what was deposited. The executor is off-chain software that runs the contracts, groups the results into batches, and submits each batch to Settlement as a commitment. A withdrawal pays out only after its batch finalizes and its inclusion proof matches the outbox root that Settlement accepted.

## Local devnet

The values below apply to the go-zenon devnet in `docker/devnet`. Its `README.md` lists the public devnet mnemonic and the pre-funded accounts. The mnemonic is public and is for a devnet only.

| Setting | Value |
|---|---|
| Chain ID and Network ID | 69 (one genesis value serves both) |
| Node URL for the console and wallet | `ws://localhost:35998` |
| Node HTTP URL | `http://localhost:35997` |
| Gateway URL | `http://127.0.0.1:35999` |
| Domain id | 1 |
| Block explorer | `http://localhost:36000` |
| Network administrator | the dev address at index 1, `z1qq6eg8n43g032hanpsfp02qcdmv7zfj3y2lt5d` |

- A momentum takes 10 seconds. An epoch is 8,640 momentums (24 hours) on a mainnet build and 60 momentums (10 minutes) on a devnet build. On a devnet build an epoch's fees settle once the epoch has ended and every batch in it is final.
- A devnet build shortens the administrator delay to 12 momentums (2 minutes), the soft delay to 6 (1 minute) and the minimum withdrawal delay to 30 (5 minutes). Mainnet builds use 17,280, 8,640 and 8,640.
- Only a devnet build makes the index 1 address the administrator. Enter it under "Administrator address" in the console's Settings and connect the wallet account with that address to see the Admin area.
- The gateway refuses browser requests from origins it does not list. Add the console's origin, for example `http://localhost:5173`, to `allowedOrigins` in the gateway configuration.

To fund an account, send ZNN and QSR to it from one of the pre-funded dev accounts. Index 1 holds 10,000 ZNN and 100,000 QSR. Indices 3, 8 and 9 each hold 50,000 ZNN and 500,000 QSR. Import the mnemonic into a wallet to sign from them. Fund your own account before a deploy, because the Finalize send pays the bytecode fee in ZNN.
