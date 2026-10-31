# vendored files

attic has two runtime dependencies. Both are copied here as plain files, unchanged, so nothing is fetched at build or run time. `tests/unit/vendor.test.js` checks every file against the sha256 below and fails if a file here is not listed.

| file | package | version | from | sha256 | licence |
|---|---|---|---|---|---|
| fflate.js | fflate | 0.8.3 | esm/browser.js | b7ca4450b19559a1d50eb381adcee94b82449674be4cd17789d9beba7e6122a1 | MIT |
| fflate.LICENSE.txt | fflate | 0.8.3 | LICENSE | 0a1df3a083d0c010560aa342e87959c8c1070e6fd54545741f083f22d0c8b551 | MIT |
| sql-wasm.js | sql.js | 1.14.2 | dist/sql-wasm.js | f1c84000dbc856c9d87f4f3aabc4d3654bd436165db4be3da13751db3a9c20d7 | MIT |
| sql-wasm.wasm | sql.js | 1.14.2 | dist/sql-wasm.wasm | 38c14f6e379210bc942bdc4ebca44e7bfdb4318ecc1c72ca666a28fdce96670a | MIT |
| sql.js.LICENSE.txt | sql.js | 1.14.2 | LICENSE | 60a3f6e4d7b29b4321359e683b36cf198d24f58e24582070f56e6fa89d5ee2be | MIT |

## packages

| package | version | published | npm integrity of the tarball |
|---|---|---|---|
| fflate | 0.8.3 | 2026-05-16 | sha512-tbZNuJrLwGUp3zshBtdy4W+ORxZuIh8a5ilyIEQDC5rY1f3U20JMry0Ll3WBzU58EZKsEuJFXhb5gwv8CsPvgA== |
| sql.js | 1.14.2 | 2026-08-14 | sha512-3ZGPovObMFrdw79zrUHbfdE/DLIsy8jdNdssmMSQuRAymedU6q84asPt0kgiqrdMYlPegDItiIMfmIXzZnYFcw== |

Vendored on 2026-10-29. sql.js 1.14.2 was chosen over 1.15.2, which was three days old at the time and followed two quick patch releases.

sql.js includes SQLite, which is in the public domain. Its licence file also carries the MIT notices for parts of its build.

## how to check

```
npm pack fflate@0.8.3 sql.js@1.14.2
npm view fflate@0.8.3 dist.integrity
npm view sql.js@1.14.2 dist.integrity
openssl dgst -sha512 -binary fflate-0.8.3.tgz | base64
tar -xzf fflate-0.8.3.tgz && sha256sum package/esm/browser.js
```

Then compare with the tables above.

## derived files

`sql-wasm.wasm.js` is not a vendored file. It is made from `sql-wasm.wasm` by `scripts/vendor-wasm.mjs`, because the page's policy (`connect-src 'none'`) does not let it fetch the wasm file. The test decodes it and checks that it matches the sha256 of `sql-wasm.wasm` above.
