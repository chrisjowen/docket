# Contributing to docket

Thank you for helping. docket is licensed under the
[Apache License, Version 2.0](LICENSE), and every contribution is accepted
under that same licence.

## Sign off your commits (DCO)

docket uses the [Developer Certificate of Origin](https://developercertificate.org/)
(DCO) instead of a contributor licence agreement. By signing off a commit, you
certify that you wrote the change, or otherwise have the right to submit it
under the project's open-source licence, as set out in the certificate below.

Sign off each commit by adding a `Signed-off-by` trailer with your real name
and an email address you can be reached at:

```text
Signed-off-by: Ada Lovelace <ada@example.com>
```

`git commit -s` adds it for you, using `user.name` and `user.email` from your
git configuration. To sign off commits you have already made on a branch, run
`git rebase --signoff main` and force-push the branch.

Every commit in a pull request must be signed off.

```text
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

## Making a change

1. Open an issue first for anything larger than a small fix, so the approach
   can be agreed before you build it.
2. Set up the workspace and check it as the README's
   [Development](README.md#development) section describes: `pnpm install`,
   then `pnpm build`, `pnpm typecheck` and `pnpm test`. CI runs the same
   steps on every pull request.
3. Keep a pull request to one change, with tests for the behaviour it adds or
   fixes, and describe what changed and why.
4. If the change is user-visible, add a note under the `## Unreleased` heading of
   [`packages/docket/CHANGELOG.md`](packages/docket/CHANGELOG.md).

Releases are cut by the maintainers, as the README's
[Releasing](README.md#releasing) section describes.
