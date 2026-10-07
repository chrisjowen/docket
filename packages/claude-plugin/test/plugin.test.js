const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it } = require("node:test");
const { checkoutKey } = require("../scripts/common.js");

const PLUGIN = path.join(__dirname, "..");

describe("plugin wiring", () => {
  it("reviews after turns, before compaction and at session end, all through one script", () => {
    const { hooks } = JSON.parse(fs.readFileSync(path.join(PLUGIN, "hooks", "hooks.json"), "utf8"));

    for (const event of ["Stop", "PreCompact", "SessionEnd"]) {
      const commands = hooks[event].flatMap((entry) => entry.hooks.map((hook) => hook.command));
      assert.deepEqual(commands, ['node "${CLAUDE_PLUGIN_ROOT}/scripts/review.js"'], event);
    }
    for (const entries of Object.values(hooks)) {
      for (const hook of entries.flatMap((entry) => entry.hooks)) {
        const script = /scripts\/([\w-]+\.js)/.exec(hook.command)[1];
        assert.ok(fs.existsSync(path.join(PLUGIN, "scripts", script)), `${script} exists`);
      }
    }
  });

  it("gives one checkout one lock however its path is spelled", (context) => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "docket-key-")));
    try {
      const checkout = path.join(dir, "Platform");
      fs.mkdirSync(checkout);
      fs.symlinkSync(checkout, path.join(dir, "link"));

      assert.equal(checkoutKey(path.join(dir, "link")), checkoutKey(checkout));
      assert.equal(checkoutKey(`${checkout}/`), checkoutKey(checkout));
      if (!fs.existsSync(path.join(dir, "PLATFORM"))) {
        context.skip("case-sensitive filesystem");
        return;
      }
      assert.equal(checkoutKey(path.join(dir, "platform")), checkoutKey(checkout));
      assert.equal(checkoutKey(path.join(dir, "PLATFORM")), checkoutKey(checkout));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
