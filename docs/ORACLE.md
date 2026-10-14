# GRAB server on Oracle Cloud Always Free

A free machine with up to 4 CPU cores and 24 GB of memory (ARM "Ampere A1"). It never sleeps,
and deep scan can run on every page. Plan for about 30–45 minutes the first time.

Always Free terms change from time to time; check Oracle's "Always Free" page if something
below looks different.

---

## 1. Create the account
1. Go to **oracle.com/cloud/free** → **Start for free**.
2. Fill in your details. A card is asked for identity checks; Always Free resources are not charged.
3. **Home region:** pick one close to you **and not too busy** (it cannot be changed later).
   Busy regions often say "out of capacity" for the free ARM machine. For India, *India West
   (Mumbai)* or *India South (Hyderabad)*; elsewhere, smaller regions usually have more room.
4. Wait for the "account is ready" email, then sign in to the **Console**.

## 2. Create the machine
1. Menu (☰) → **Compute → Instances → Create instance**.
2. **Name:** `grab`.
3. **Image and shape → Edit**:
   - Image: **Canonical Ubuntu 22.04** (or 24.04).
   - Shape: **Change shape → Ampere → VM.Standard.A1.Flex**, set **4 OCPUs** and **24 GB** memory.
     (If that is refused, try 2 OCPUs / 12 GB; it is still far more than the old server.)
4. **Networking:** keep the defaults (a new virtual cloud network with a public subnet), and make
   sure **Assign a public IPv4 address** is on.
5. **Add SSH keys → Generate a key pair for me → Save private key** (keep this file safe).
6. **Create.** When the status turns green (**Running**), copy the **Public IP address**.

> "Out of capacity"? Try another **Availability domain** in the same form, fewer OCPUs, or try
> again later in the day.

## 3. Open ports 80 and 443 (needed for HTTPS)
1. On the instance page, click the **Subnet** link → its **Default Security List**.
2. **Add Ingress Rules**, twice:
   - Source CIDR `0.0.0.0/0`, IP protocol **TCP**, Destination port **80**
   - Source CIDR `0.0.0.0/0`, IP protocol **TCP**, Destination port **443**

(The setup script opens the same ports inside the machine's own firewall.)

## 4. Run the setup (one command)
Open a terminal on the machine. Easiest: on the instance page click **Cloud Shell** at the top of
the console, or on Windows use PowerShell:

```
ssh -i C:\path\to\the-private-key.key ubuntu@<PUBLIC-IP>
```

Then paste:

```
curl -fsSL https://raw.githubusercontent.com/umangpatel2191/grab/main/scripts/oracle/setup.sh | bash
```

It installs Docker, builds GRAB (5–10 minutes the first time), starts it with automatic
restarts, and sets up free HTTPS. At the end it prints:

```
GRAB is live:  https://<your-ip-with-dashes>.sslip.io
```

Open `https://<that address>/v1/health` in your browser: it should show `"ok":true`.

**Send that address** — the plugin's server address and `manifest.json` are then changed to it
and the plugin is rebuilt.

*Own domain instead?* Point an A record (e.g. `grab.yourdomain.com`) at the public IP, then run
the same command with the name at the end: `... | bash -s -- grab.yourdomain.com`.

## 5. Updating later
When new code is pushed to GitHub, on the machine run:

```
bash ~/grab/scripts/oracle/update.sh
```

## Troubleshooting
| Problem | Fix |
|---|---|
| Setup ends with "Not reachable over HTTPS yet" | Step 3 (ingress rules) is missing; add it and run the setup command again |
| `curl https://.../v1/health` times out | `sudo docker ps` should list `grab` and `grab-caddy`; `sudo docker logs grab --tail 50` |
| Certificate errors | `sudo docker logs grab-caddy --tail 50`; sslip.io certificates can be rate-limited, use your own domain then |
| Out of capacity when creating the machine | Other availability domain, fewer OCPUs, or retry later |
| Machine stopped by Oracle as "idle" | Free machines that stay almost unused for 7 days may be reclaimed; regular use keeps it alive. Upgrading the account to Pay As You Go (still free within Always Free limits) removes this |
