# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.2.x   | Yes       |
| < 0.2   | No        |

## Reporting a Vulnerability

Please report vulnerabilities privately through GitHub Security Advisories:

https://github.com/amdkholil/ChillDB/security/advisories/new

Do not open a public issue for a security problem. Include the affected
version, operating system, reproduction steps, and any relevant error output.
Never include database passwords, SSH secrets, webhook URLs, or other
credentials in a report.

## Security Scope

Reports are especially welcome for:

- Connection profile and credential storage
- SSH tunnel handling and host-key verification
- SQL construction for row editing, identifiers, and DDL
- The Discord error-notification webhook
- Tauri command boundaries between the frontend and backend

ChillDB stores profiles without passwords. Saved passwords and SSH secrets are
kept in the operating system credential store. The Discord webhook URL is read
from `CHILLDB_DISCORD_WEBHOOK` or from the app data directory and is never
committed to the repository.
