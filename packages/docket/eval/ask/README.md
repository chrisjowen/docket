# Ask evaluation

How often `docket ask` answers correctly, says it does not know, or makes
something up. The questions are about the example docket in
[`examples/acme-platform`](../../../../examples/acme-platform). The scoring
follows the CRAG-style evaluation in Wedge et al., *Reducing Hallucinations in
Complex Question Answering using Simple Graph-based RAG*
([arXiv:2606.05901](https://arxiv.org/abs/2606.05901)). A wrong answer costs
more than a refusal.

It calls models, so it is never part of `pnpm test`. Run it on demand:

```sh
pnpm -C packages/docket eval:ask
```

The run prints the score table and one line per question. When a model it
needs is missing, it prints `ask evaluation skipped: <why>` and the run is
reported as skipped, not failed.

## What it does

1. Copies `examples/acme-platform` to a temporary directory, without any
   index, and sets its `summarize` model to the answerer.
2. Runs `docket sync` on the copy.
3. Asks each question in [`questions.yaml`](questions.yaml) through
   `askProject` with synthesis on, as `docket ask` does.
4. Gives each summary to the judge. The judge uses the paper's fine-grained
   prompt (Appendix C.2.2) word for word: [`judge.ts`](judge.ts). Two
   refusals score 0 without the judge: no summary, because the adapters found
   nothing, and a summary that is exactly the refusal sentence "Not recorded
   in Docket." (any case or trailing punctuation, as `docket ask` recognises
   it). A judge reply with no score in it, or a judge that fails, is asked
   once more. If it still gives no score, the question is an error: it is
   left unscored and listed with the judge's raw reply.
5. Scores the replies and prints the table: [`score.ts`](score.ts).

The example's only adapter is JSONL: lexical search, covering top matches
only. The count questions therefore test whether the summary counts only
what it may. A sample is not a total.

## The questions

There are 52 questions:

- **16 lookups:** one record answers it.
- **13 multi-hop:** answering means following a link or a mention to a second
  record ("who owns the datasource Orders depends on").
- **10 counts:** a number the files fix.
- **13 not recorded (25%):** plausible questions the docket does not answer,
  such as "who is on call this week". The right response is to say it is not
  recorded.

Each question lists its `answers`, the ground truth the judge matches against
(every item is needed for full marks). It also lists its `basis`, the records
that hold the answer, so a reviewer can check it. `pnpm test` checks the set's
shape and that every `basis` id exists in the example (`eval.test.ts`).

## Scoring

The judge returns one score per answer:

| Score | Meaning |
| --- | --- |
| +1 | Fully correct: every ground-truth answer. |
| +0.5 | Partly correct: some of the answers, and nothing wrong. |
| 0 | Missing: it said it could not answer. |
| −0.5 | Some correct answers mixed with wrong ones. |
| −1 | Wrong. |

A not-recorded question has an empty ground truth. Saying it is not recorded
scores 0, and any answer scores −1. A judge that rewards the refusal is held
to 0. Saying so is right, but it is not an answer.

The table gives each category and the whole set:

- the count at each score;
- questions the judge left unscored (`unscored`), which are left out of every sum;
- **fine truthfulness:** the sum of the scores, with the mean per scored
  question in brackets;
- **coarse truthfulness:** the paper's coarse metric (Appendix C.2.1)
  applied to the same judgments. +1 stays 1, 0 stays 0, and anything partly
  or wholly wrong is −1.

Below the table:

- how many answers the judge took as answers (not 0) yet cite nothing they
  were given;
- the codes of any diagnostics the answers carried;
- each unscored question, with the judge's raw reply. `outcomes.json` lists
  them too, under `unscored`.

## Models

The answerer and the judge must come from different model families, or the
judge grades its own kind's answers kindly. A run whose answerer and judge
share a family stops with an error. Name each model as `claude`,
`claude:<model>` (the `claude` CLI with `--model`) or `ollama:<model>`.

| Variable | Default | |
| --- | --- | --- |
| `DOCKET_EVAL_ANSWERER` | `ollama:qwen2.5:7b` | The summarizer, as `docket ask` would use it. |
| `DOCKET_EVAL_JUDGE` | `claude:sonnet` | |
| `DOCKET_EVAL_OLLAMA_URL` | `http://localhost:11434` | |
| `DOCKET_EVAL_ONLY` | | Comma-separated question ids, e.g. `L01,N01`. |
| `DOCKET_EVAL_CONCURRENCY` | `4` | Questions asked of a `claude` model at once. An Ollama model is asked one at a time. |
| `DOCKET_EVAL_OUT` | | A directory to write `report.md` and `outcomes.json` to: every answer, judge reply and score. |

`ollama:llama3.1` can judge instead, with a Claude answerer (the paper's
judge was also a Llama model, Llama-4-Maverick):

```sh
DOCKET_EVAL_ANSWERER=claude DOCKET_EVAL_JUDGE=ollama:llama3.1 pnpm -C packages/docket eval:ask
```

That small local judge is noisy and biased, so its scores are not to be
trusted:

- it sometimes marks a fully correct answer +0.5;
- it misjudges refusals. It scored the bare refusal "Not recorded in Docket."
  −1 on not-recorded questions and +1 on a count question, and scores most
  refusals −1 when they add what *is* recorded ("no on-call engineer is
  recorded; Platform Engineering owns Orders"). The evaluation scores the
  bare refusal sentence itself, but a refusal in other words still goes to
  the judge.

The judges are not deterministic, as the paper notes (§4.3), and nor are the
answers. Compare runs of the same pair of models, and treat a difference of
a few points as noise.
