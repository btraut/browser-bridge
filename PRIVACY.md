# Browser Bridge Privacy Policy

Effective date: 2026-02-06

This Privacy Policy describes how the Browser Bridge Chrome extension ("Browser Bridge", "we") handles data.

## Summary

Browser Bridge is a companion extension for the Browser Bridge CLI/MCP tools. It can automate actions in your browser and inspect page state when you request those actions through Browser Bridge.

Browser Bridge does not include analytics, advertising, or tracking. We do not sell personal information.

## Data Browser Bridge Can Access

Depending on which Browser Bridge commands you run, the extension may access:

- Tab information such as URL and title (to select and operate on the correct tab).
- Page content and structure (for example, DOM snapshots, element text, and accessibility tree data).
- Console output and runtime errors (for debugging).
- Network request information (for example, to produce a HAR export).
- Performance metrics (for example, timing and performance counters).
- Page state you request, including:
  - Form field values (password fields are redacted).
  - localStorage and sessionStorage entries (truncated).
  - Cookies available to the page via `document.cookie` (truncated).

## How Data Is Used

Data is used only to:

- Perform the browser actions you requested (navigate, click, type, scroll, etc.).
- Return inspection and diagnostic results you requested (DOM snapshots, console output, network HAR, page state, performance metrics).
- Capture artifacts you requested (for example, screenshots).

## Data Sharing and Transmission

The extension communicates with a Browser Bridge companion process running on your computer to receive commands and return results. Browser Bridge does not transmit your data to our servers.

If you use Browser Bridge with third-party tools (for example, an IDE, an MCP client, or an AI assistant), those tools may receive the results you requested. Their handling of that data is governed by their own policies and settings.

## Data Storage and Retention

- The extension may store small configuration values (for example, connection settings and timeouts) using Chrome extension storage.
- Browser Bridge may write artifacts (for example, screenshots or HAR files) to your machine when you request them. Retention depends on your local environment and how you manage those files.

We do not maintain a remote database of your browsing data.

## Your Choices

- Install or remove the extension at any time.
- Use Browser Bridge only on sites you choose.
- Avoid running commands that capture sensitive information (for example, page state or network HAR) on sensitive pages if you do not want that information collected into outputs.

## Security

Browser Bridge is intended for developer workflows. Like any developer tool with broad permissions, it can access sensitive data present in pages you use it on. Keep your machine and browser environment secure, and do not run untrusted software alongside Browser Bridge.

## Contact

Questions or concerns:

- GitHub issues: https://github.com/btraut/browser-bridge/issues

## Changes to This Policy

We may update this policy as the product evolves. The effective date at the top indicates the most recent revision.
