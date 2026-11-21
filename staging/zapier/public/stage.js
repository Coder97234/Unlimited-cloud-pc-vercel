const field = document.querySelector('#domain');
const ready = location.origin === `https://${field.value}`;
const status = document.querySelector('#host-status');
status.textContent = ready ? 'HTTPS staging host' : 'Preview only';
status.classList.toggle('ready', ready);
document.querySelector('#host-hint').textContent = ready
  ? 'Copy the hostname below, without https:// or a trailing slash.'
  : 'Wait until this page is reachable on the exact HTTPS hostname below before saving it in Zapier.';

const button = document.querySelector('#copy');
const note = document.querySelector('#copy-note');
button.hidden = false;
button.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(field.value);
    note.textContent = 'Hostname copied.';
  } catch {
    field.focus();
    field.select();
    note.textContent = 'Hostname selected. Copy it with your keyboard or touch menu.';
  }
});
