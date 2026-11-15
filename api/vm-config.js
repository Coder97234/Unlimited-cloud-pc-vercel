// Vercel serverless function: exposes the browser-safe part of the VM configuration
// the static pages need. Never returns secrets (that's what the /vm/* passcode gate is for).
//
// Configure in the Vercel project (Settings → Environment Variables), all optional:
//   VM_DESKTOP_URL   full https URL of the Windows desktop (dockurr/windows port 8006),
//                    e.g. https://8006-my-codespace-abc123.github.dev
//   VM_BOOT_URL      URL to start the machine (defaults to *.yml in GitHub Codespaces)
//   VM_LABEL         name shown in the UI, e.g. "Windows 10 — noah's codespace"
module.exports = (req, res) => {
  const desktopUrl = (process.env.VM_DESKTOP_URL || "").trim();
  const bootUrl = (process.env.VM_BOOT_URL || "").trim();

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.status(200).send(
    JSON.stringify({
      configured: Boolean(desktopUrl),
      desktopUrl: desktopUrl || null,
      bootUrl: bootUrl || null,
      label: (process.env.VM_LABEL || "Windows 10").trim(),
      // tells the front end how the desktop is embedded and what to do if it won't embed
      embed: "iframe",
      notes: desktopUrl
        ? []
        : [
            "Set VM_DESKTOP_URL in the Vercel project to the public URL of the Windows desktop " +
              "(the port 8006 address of your dockurr/windows container).",
          ],
    })
  );
};
