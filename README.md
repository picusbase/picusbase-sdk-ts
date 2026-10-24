# picusbase-sdk (TypeScript)

Browser client for the [PicusBase](https://github.com/picusbase) platform: sign-in (OAuth PKCE),
entity records, comments and attachments, file uploads, and Picus Functions. No runtime
dependencies. Uses `fetch`, `localStorage`, `sessionStorage` and `location`, so it runs in the
browser, not in Node.

```sh
npm install picusbase-sdk
```

```ts
import { PicusClient } from 'picusbase-sdk';

const picus = new PicusClient({
  consoleUrl: 'https://console.example.com',
  authUrl: 'https://auth.example.com',
  functionsUrl: 'https://functions.example.com',
  projectRef: 'p_xxxxxxxx',
  oauthClientId: 'oauth-client-id',
});

await picus.auth.completeLogin();
if (!picus.auth.currentUser()) await picus.auth.login();

const orders = await picus.records.list<{ status: string }>('sales_order', {
  filters: [['status', 'eq', 'open']],
});
```

## API

| Member | Purpose |
|---|---|
| `auth` | `login`, `completeLogin`, `logout`, `currentUser`, `accessToken`, `computeToken`. |
| `records` | `list`, `get`, `create`, `update`, `patch`, `remove`, `aggregate`. |
| `recordExtras` | Comments, activity, attachments, tags, members and assignees of a record. |
| `storage` | `uploadFile`, `fileUrl`. |
| `functions` | `request`, `call`, `invoke`, `runAction`, `query`. |
| `runWorkflow`, `myRoles` | Run a workflow; read the signed-in user's roles. |

## Versioning

A release is a git tag `vX.Y.Z` that matches `version` in `package.json`. The tag publishes the
package to npm with provenance. Pre-1.0, a minor bump may contain breaking changes; each
release notes them.

### Releasing

The release workflow needs the repository secret `NPM_TOKEN`: a npm granular access token with
read and write access to packages, and the "bypass two-factor authentication" option ticked.
Set it with the GitHub CLI and paste the token at the prompt, never on the command line:

```sh
gh secret set NPM_TOKEN -R picusbase/picusbase-sdk-ts
```

Then bump `version` in `package.json`, merge it, and tag the merge commit:

```sh
git tag -a vX.Y.Z -m "vX.Y.Z: <summary>" && git push origin vX.Y.Z
```

The `Release` workflow checks that the tag matches `package.json`, then publishes. If it fails
at the publish step, the token is missing, expired or lacks write access.

## License

MIT. See [LICENSE](LICENSE).
