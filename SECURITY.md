# Security

Maximum Overdrive holds people's private journals, photos and daily notes, so security reports are very welcome.

## Reporting a vulnerability

Please report it privately through GitHub's **Report a vulnerability** button (the repository's Security tab)
instead of opening a public issue. Include what you found, how to reproduce it and what it lets someone do.
You'll get an answer within a week, and credit in the fix if you want it.

## In scope

- Reading or changing another person's data: their tracker, their own journal, a couple's shared journal from
  outside the couple, hidden photos, coach chats, moods or daily answers.
- Getting around login, email verification, password reset, invite codes, PIN locks or their rate limits.
- Cross-site request forgery, stored cross-site scripting, path traversal, or uploads served as something other than
  an image.
- The server trusting data from the app that it shouldn't (for example deleting in someone else's name).

## Known limits (not vulnerabilities)

These are described in the README:

- Data is not encrypted at rest; whoever controls the server can read it.
- The app keeps an offline copy of your data and recently seen photos in the browser.
- "Hide private goals" only hides them on screen.
- `MAX_ALLOWED_LOGIN` trusts the `Tailscale-User-Login` header, so it's only safe when Tailscale Serve is the only way
  to reach the server.
- `MAX_DEV_MODE=1` turns off protections meant for production and must never be used there.

## Supported versions

Only the latest commit on the main branch gets fixes.
