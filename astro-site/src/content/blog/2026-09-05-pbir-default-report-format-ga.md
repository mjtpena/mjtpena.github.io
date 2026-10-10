---
title: "PBIR Is Now the Default: What Changes for Report Source Control"
description: "Developer mode and PBIP are GA and PBIR becomes the default report format. Why that makes report review realistic, what breaks, and how to stage the move."
author: Michael John Peña
draft: false
date: 2026-09-05
tags:
  - Power BI
  - Microsoft Fabric
  - CI/CD
  - DevOps
  - Git
---

For years, the semantic model was the only part of a Power BI solution you could sensibly review in a pull request. The report sat in one `report.json` file full of escaped JSON strings, so a diff told you *that* something changed, not *what*. Message Center post [MC1465770](https://mc.merill.net/message/MC1465770), published on 1 September 2026, changes that: Power BI developer mode and the [PBIP format](https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-overview) are now generally available, and PBIR becomes the default report metadata format in Desktop and the service, rolling out from mid-September. If your team keeps reports in Git, the next few weeks decide whether this happens on your terms or one edited report at a time.

## What the announcement actually says

The key points from MC1465770:

- **Developer mode and PBIP are GA.** PBIP is the code-based project format, with PBIR for report definitions and TMDL for semantic models.
- **PBIR is the default report format** in Power BI Desktop and the service. Even inside a `.pbix`, report metadata is now stored as PBIR rather than PBIR-Legacy. PBIX itself is not going anywhere; Microsoft is explicit that PBIR does not replace PBIX.
- **PBIR-Legacy reports still open**, but a report edited in Power BI tools is upgraded to PBIR automatically.
- **The tenant setting "Automatically convert and store reports using Power BI enhanced metadata format (PBIR)" is being removed**, because PBIR is no longer opt-in.
- Rollout covers worldwide, GCC, GCC High and DoD from mid-September, and Microsoft says no action is required.

"No action required" is true for a business user. It isn't true for anyone with a repository, a build pipeline, or a script that reads report files. Removing the tenant setting matters here: admins can no longer hold back the conversion centrally, so any staging has to happen in your delivery process.

This is the end of a long run-up. Microsoft flagged the transition on the Power BI blog well in advance, and that post went through several timeline updates as the service and Desktop defaults moved. The GA message settles it: PBIR is the default everywhere.

## Why this finally makes report review realistic

PBIR-Legacy stores the whole report in one `report.json`. Pages live in a `sections` array, and each visual's real definition sits in a `config` property as a *stringified* JSON blob. Move a slicer two pixels and the diff shows a changed line hundreds of characters wide. No reviewer reads that, so in practice nobody did. Report changes went through Git unreviewed while the TMDL model next to them got proper scrutiny.

PBIR splits the report into a folder tree, documented in [Power BI Desktop project report folder](https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-report):

```text
Sales.Report/
  definition.pbir
  definition/
    version.json
    report.json
    pages/
      pages.json
      <pageName>/
        page.json
        visuals/
          <visualName>/
            visual.json
    bookmarks/
  StaticResources/
```

Each page and each visual is its own file, made of ordinary JSON with a `$schema` reference to a published, versioned schema. That brings three practical changes:

1. **Diffs are scoped.** Changing one chart usually touches one `visual.json`. A reviewer can see the field that was swapped, the filter that was added or the visual type that changed.
2. **Merge conflicts become rare and solvable.** Two developers editing visuals on different pages no longer touch the same file. Adding or reordering pages still touches `pages.json`, and report-level filters and themes live in `report.json`, so expect the occasional small conflict there. When two people do collide, the conflict is in readable JSON.
3. **Linting becomes cheap.** Public schemas plus one file per object means a short script can enforce rules. Before, it needed a parser that unpicked nested strings.

I'd treat that third point as the real payoff. Code review catches intent; linting catches the boring, repeated mistakes nobody wants to comment on by hand.

## A report lint you can run in CI

Here's a small, dependency-free Python check I'd put in a pull request pipeline. It reports any folder still in PBIR-Legacy format, flags pages with too many visuals, flags pages left with a default "Page N" name, and enforces an allowlist of visual types. Run it with `--legacy-as-warning` while you're still converting, so legacy folders are listed without failing the build. Adjust the thresholds and the list to suit your standards.

```python
#!/usr/bin/env python3
"""Lint PBIR report folders in a repository. Exit code 1 on any error."""
import argparse
import json
import re
import sys
from pathlib import Path

MAX_VISUALS_PER_PAGE = 20
ALLOWED_VISUAL_TYPES = {
    "card", "cardVisual", "tableEx", "pivotTable", "slicer",
    "clusteredBarChart", "clusteredColumnChart", "lineChart",
    "lineClusteredColumnComboChart", "textbox", "shape", "image",
    "actionButton",
}
DEFAULT_PAGE_NAME = re.compile(r"^Page \d+$")


def load(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def lint_report(report_dir: Path, root: Path) -> tuple[list[str], list[str]]:
    """Return (errors, legacy) for one .Report folder."""
    errors: list[str] = []
    definition = report_dir / "definition"
    if not definition.is_dir():
        if (report_dir / "report.json").exists():
            return errors, [f"{report_dir.relative_to(root)}: PBIR-Legacy format (report.json at root)"]
        errors.append(f"{report_dir.relative_to(root)}: no definition folder found")
        return errors, []

    for page_json in sorted((definition / "pages").glob("*/page.json")):
        page = load(page_json)
        label = f"{report_dir.name} / {page.get('displayName', page_json.parent.name)}"

        if DEFAULT_PAGE_NAME.match(page.get("displayName", "")):
            errors.append(f"{label}: page still has a default name")

        visual_files = sorted(page_json.parent.glob("visuals/*/visual.json"))
        if len(visual_files) > MAX_VISUALS_PER_PAGE:
            errors.append(f"{label}: {len(visual_files)} visuals (limit {MAX_VISUALS_PER_PAGE})")

        for visual_json in visual_files:
            container = load(visual_json)
            visual = container.get("visual")
            if visual is None:
                continue  # group containers carry visualGroup instead of visual
            visual_type = visual.get("visualType", "<missing>")
            if visual_type not in ALLOWED_VISUAL_TYPES:
                errors.append(
                    f"{visual_json.relative_to(root)}: uses '{visual_type}', not on the allowlist"
                )
    return errors, []


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", default=".", help="repository folder to scan")
    parser.add_argument(
        "--legacy-as-warning",
        action="store_true",
        help="report PBIR-Legacy folders as warnings without failing the run",
    )
    args = parser.parse_args()

    root = Path(args.root).resolve()
    report_dirs = sorted(p for p in root.rglob("*.Report") if p.is_dir())
    all_errors: list[str] = []
    all_legacy: list[str] = []
    for d in report_dirs:
        errors, legacy = lint_report(d, root)
        all_errors += errors
        all_legacy += legacy

    if args.legacy_as_warning:
        for item in all_legacy:
            print(f"warning: {item}")
    else:
        all_errors += all_legacy
    for e in all_errors:
        print(f"error: {e}")
    print(f"{len(report_dirs)} report(s) checked, {len(all_errors)} error(s), "
          f"{len(all_legacy)} legacy")
    return 1 if all_errors else 0


if __name__ == "__main__":
    sys.exit(main())
```

This is deliberately boring. The visual type allowlist is the rule I'd add first: it stops unapproved custom visuals slipping in, which is usually a governance question before it is a design one. Community tools such as [PBI Inspector](https://github.com/NatVanG/PBI-Inspector) take the same idea further with configurable rule sets. Start with a handful of rules your team already agrees on, though. A lint that fails every build on day one gets switched off by day three.

## What breaks

Anything that assumed the legacy layout. Look for these in your estate:

- **Scripts that parse `report.json` directly.** Field inventories, "which reports use this measure" scanners, documentation generators, and anything that did `json.loads(section["visualContainers"][i]["config"])`. Under PBIR there's no `sections` array and no stringified `config`; the data is spread across `page.json` and `visual.json` files.
- **Scripts that pull definitions from the service.** The [Get Report Definition](https://learn.microsoft.com/en-us/rest/api/fabric/report/items/get-report-definition) API can return either format and takes an optional `format` parameter, so code that pulls definitions through the REST API should request the format it expects and check what it got. Don't assume the parts list looks the way it did last month.
- **Find-and-replace deployment steps.** Teams that rewrote connection details or swapped visual properties with regex over `report.json` need to retarget those edits at `definition.pbir` and the individual visual files. For REST deployments, the [report definition](https://learn.microsoft.com/en-us/rest/api/fabric/articles/item-management/definitions/report-definition) requires `definition.pbir` to use a `byConnection` reference rather than `byPath`.
- **Reviews that are only noise.** The first commit after an ad hoc upgrade deletes one large file and adds dozens of small ones. If that lands inside a feature branch alongside real changes, the real changes are effectively unreviewable.
- **Path length.** PBIR adds folder depth. Windows path limits that never troubled a single `report.json` can bite a repository already nested a few levels down.

None of these is hard to fix. They just fail quietly. A scanner that finds zero visuals still exits cleanly.

## Stage the conversion instead of letting it happen on edit

Auto-upgrade on edit is a sensible default for the service. For a repository, it means each report converts whenever someone happens to touch it, mixed in with whatever else they changed. I'd convert deliberately instead:

1. **Inventory first.** List every `.Report` folder and record which are still PBIR-Legacy. Running the lint above with `--legacy-as-warning` lists them without breaking any builds. Find every script, pipeline step and notebook that reads report metadata.
2. **Fix the consumers before the reports.** Update the scripts to handle both formats during the transition, so nothing breaks while the estate is half converted.
3. **Convert in dedicated commits.** One report, or one small batch, per pull request: open the project in a current Desktop, save, and commit the result with no other changes. The reviewer's job is only to confirm the report still renders and publishes.
4. **Take your own backup.** Microsoft [documents temporary safety nets](https://learn.microsoft.com/en-us/power-bi/developer/projects/projects-report): Desktop keeps a pre-conversion backup for 30 days, and reports converted in the service can be restored as PBIR-Legacy from report settings within 28 days. Git history is the backup you control, so tag the pre-conversion commit.
5. **Turn the lint gate on last.** Once a workspace's reports are all PBIR, drop `--legacy-as-warning` from the pipeline so a legacy folder fails the build and nothing regresses.

If your reports live only in the service with no Git connection, there's less to stage. Let the upgrade happen and keep the restore window in mind. The staging effort pays off where [Fabric Git integration](/blog/2024-04-06-fabric-git-integration/) and a [deployment pipeline](/blog/2024-04-07-fabric-cicd/) already treat reports as code.

## The decision

PBIR becoming the default doesn't change what a report looks like to its users. It changes whether the people building reports can work like software engineers: small reviewable diffs, automated checks, and conflicts you can resolve. My recommendation for any team with reports in source control is to spend a sprint on it now. Inventory, fix the parsers, convert in clean commits, then switch on linting. If you're also tightening how the rest of the tenant is managed, the same thinking applies at a larger scale in [treating a Fabric tenant as code](/blog/2026-07-27-fabric-cicd-is-solved-your-tenant-isnt-tenant-as-code/). Let the conversion happen by accident and you lose the clean history, which was the main reason to adopt the format.
