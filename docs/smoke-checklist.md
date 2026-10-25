# Console smoke checklist

Run this checklist before each zeno-console release and in each devnet pass of the activation runbook. Every item needs sends signed by a browser wallet. Connect the wallet and pick the network in the node selector (chain id 69 on the devnet), because a fresh browser starts on chain id 1.

- [ ] Deploy: from `/deploy`, deploy a module (Start, each chunk, Finalize), one wallet prompt per send. The success link opens `/contracts/<domain>/<id>`.
- [ ] Redeploy: deploy the same module twice from one address. The second run sends Start, every chunk and Finalize again.
- [ ] Call: the Call tab sends a call, and its `/tx` page reaches Finalized with the receipt badge Verified and no "(unchecked)" mark.
- [ ] Manage: Deposit and Buy storage each send once.
- [ ] Upgrade: deploy an owner-upgradeable contract, follow the upgrade link from its Manage tab, and finish the upgrade on `/deploy`.
- [ ] Withdrawals: produce a withdrawal to another address. On `/withdrawals`, "Mine only" hides it; turn it off, relay it, then release the queue.
- [ ] Domain 2: register a second domain as the administrator, deploy from `/deploy?domain=2` and relay from `/withdrawals?domain=2`. The sends land in domain 2, and the success link opens `/contracts/2/<id>`.
- [ ] Admin: with the administrator address in Settings and the administrator account connected, send Pause, then Resume. Each resolves only once Settlement shows the change, and each `/tx` page ends at Received with no Executed step.
- [ ] Events: on `/domains/<id>/events`, a decoded event with long values (an account or asset field) wraps inside its cell and leaves the Verification column clear.
- [ ] Sidebar: at a desktop width, collapse the sidebar. The Zeno mark in the header sits centred over the sidebar icons.
