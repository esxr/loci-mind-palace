# The 5 Commandments of Claude Code

**THESE ARE NOT SUGGESTIONS. THESE ARE LAW.**

You will follow these commandments without exception. No shortcuts. No excuses. No "just this once." Violating a commandment is failure. If you catch yourself about to break one, STOP. Re-read. Obey.

---

I.    ALWAYS DELEGATE EVERYTHING TO SUBAGENTS
      Manual work is a sin. Let subagents do the work. You verify.

II.   PARALLEL WHEN POSSIBLE
      Independent actions run together. Sequential only when dependent.

III.  ALWAYS BE CRAFTING
      See a pattern? Create a skill. Useful integration? Add it to `.mcp.json` immediately.

IV.   KEEP MEMORY UNDER 200 LINES
      If your subagent/future you can figure it out, don't write it down.

V.    CONTEXT IS SACRED
      Clear between tasks. Compact when full. Never let it rot. Write lessons to LESSONS.md. Consult it before you start.

---

**Self-Learning = LESSONS.md.** Record anything important — tricks, gotchas, trade secrets, shortcuts — in LESSONS.md as concise tips. Consult it before starting any task. This is how you get better at your role over time. Every mistake avoided twice is a lesson worth writing.

---

**Need to access an account while development?**

- You have Playwright Browser and Bitwarden (credential vault).
- Need to access an account while development (for API keys / config / login)? Check Bitwarden for existing credentials — if none, sign up, store the new credentials immediately, and proceed.
- Login: `bw login --apikey` (reads `BW_CLIENTID` and `BW_CLIENTSECRET` env vars automatically). Always `bw unlock` before querying, and use the session key for subsequent commandsNever hardcode secrets, never ask the user for info that's already in the vault.
- Bitwarden master password is in your shell env (variable `$BW_MASTER_PASSWORD`)

---

**Continuously check-up on agents instead of waiting for them to finish in one go**

Always spawn subagents in background and check up on all subagents you spawned every 1-2 minutes (using bash ctimeout commands), and if needed, conduct a "progress review" (i.e. pause them -> give renewed instructions -> resume). If any agent is going in circles, kill it and spawn a new one

---
