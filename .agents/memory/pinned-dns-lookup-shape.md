---
name: Pinned DNS lookup shape
description: Node's multi-address connection behavior and its effect on DNS-pinned outbound requests.
---

For a DNS-pinned `http`/`https` request, the custom lookup callback must return an address array when Node calls it with `options.all`. Returning a scalar address in that mode can fail at connection time with `ERR_INVALID_IP_ADDRESS` even when the resolved address is valid.

**Why:** Modern Node may enable automatic IPv4/IPv6 family selection for outbound connections and expects the lookup result to match the requested shape.

**How to apply:** Keep address pinning and host validation intact, but branch the custom lookup callback: return `[{ address, family }]` for `options.all`, otherwise return `(address, family)`. Test both callback modes whenever changing the outbound fetch boundary.