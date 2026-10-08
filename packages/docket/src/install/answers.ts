import { createInterface } from 'node:readline/promises'

/** One option of a multiple-choice question. */
export interface Choice {
  value: string
  label: string
}

/**
 * Asks the developer questions. Injectable, so tests script the answers; the
 * real one reads the terminal.
 */
export interface Prompter {
  /** A free-text answer; an empty reply means `fallback` (or empty when there is none). */
  text(question: string, fallback: string | undefined): Promise<string>
  /** One of `choices`, by value or number; an empty reply means `fallback`. */
  choose(question: string, choices: readonly Choice[], fallback: string): Promise<string>
  /** Yes or no; an empty reply means `recommended`. */
  confirm(question: string, recommended: boolean): Promise<boolean>
  /** A line shown between questions, such as why an answer was not accepted. */
  note(line: string): void
}

/** Reads one line of the terminal per question. */
export const terminalPrompter = (): Prompter => {
  const ask = async (question: string): Promise<string> => {
    const prompt = createInterface({ input: process.stdin, output: process.stdout })
    try {
      return (await prompt.question(question)).trim()
    } finally {
      prompt.close()
    }
  }
  return {
    text: async (question, fallback) => {
      const answer = await ask(`${question}${fallback ? ` [${fallback}]` : ''} `)
      return answer === '' ? (fallback ?? '') : answer
    },
    choose: async (question, choices, fallback) => {
      console.log(question)
      choices.forEach((choice, index) => console.log(`  ${index + 1}) ${choice.label}`))
      const answer = await ask(`Choose 1-${choices.length} [${choices.findIndex((c) => c.value === fallback) + 1}] `)
      if (answer === '') return fallback
      const byNumber = choices[Number(answer) - 1]
      return byNumber?.value ?? answer
    },
    confirm: async (question, recommended) => {
      const answer = (await ask(`${question} ${recommended ? '[Y/n]' : '[y/N]'} `)).toLowerCase()
      return answer === '' ? recommended : answer.startsWith('y')
    },
    note: (line) => console.log(line)
  }
}

/** Why a value is not acceptable, or undefined when it is. */
export type Check = (value: string) => string | undefined

export interface TextQuestion {
  /** The command-line option that answers it without asking, e.g. `--url`. */
  flag: string
  question: string
  /** Taken when nothing is given; asked questions offer it as the default. */
  fallback?: string | undefined
  /** An empty answer leaves the setting out. */
  optional?: boolean | undefined
  /** Said when the value is required, has no fallback and no terminal can ask for it. */
  hint?: string | undefined
  check?: Check | undefined
}

export interface ChoiceQuestion {
  flag: string
  question: string
  choices: readonly Choice[]
  fallback: string
}

/**
 * Where each answer comes from: the option given on the command line, else
 * the developer at a terminal, else its default. A required answer with none
 * of those is an error naming the option, so a script learns what to pass.
 */
export class Answers {
  private readonly read = new Set<string>()

  constructor(
    private readonly given: Readonly<Record<string, string | undefined>>,
    private readonly prompter: Prompter | undefined
  ) {}

  /** Options given that no question read: they do not apply to what was chosen. */
  unused(): string[] {
    return Object.keys(this.given).filter((flag) => this.given[flag] !== undefined && !this.read.has(flag))
  }

  /** Whether questions are asked at all. */
  get interactive(): boolean {
    return this.prompter !== undefined
  }

  note(line: string): void {
    this.prompter?.note(line)
  }

  async confirm(question: string, recommended: boolean): Promise<boolean> {
    return this.prompter === undefined ? false : this.prompter.confirm(question, recommended)
  }

  /** The value of `question.flag`, if it was given, checked. */
  private passed(question: { flag: string }, check?: Check): string | undefined {
    this.read.add(question.flag)
    const value = this.given[question.flag]
    if (value === undefined) return undefined
    const problem = check?.(value)
    if (problem !== undefined) throw new Error(`${question.flag} ${JSON.stringify(value)}: ${problem}`)
    return value
  }

  async text(question: TextQuestion & { optional: true }): Promise<string | undefined>
  async text(question: TextQuestion): Promise<string>
  async text(question: TextQuestion): Promise<string | undefined> {
    const passed = this.passed(question, question.check)
    if (passed !== undefined) return passed === '' && question.optional ? undefined : passed

    if (this.prompter === undefined) {
      if (question.fallback !== undefined) {
        const problem = question.check?.(question.fallback)
        if (problem !== undefined) throw new Error(`${question.flag} is required: its default ${JSON.stringify(question.fallback)} will not do (${problem}).`)
        return question.fallback
      }
      if (question.optional) return undefined
      throw new Error(`${question.flag} is required${question.hint ? `: ${question.hint}` : '.'}`)
    }

    for (;;) {
      const answer = await this.prompter.text(question.question, question.fallback)
      if (answer === '') {
        if (question.optional) return undefined
        this.prompter.note('  An answer is required.')
        continue
      }
      const problem = question.check?.(answer)
      if (problem === undefined) return answer
      this.prompter.note(`  ${problem}`)
    }
  }

  async choose(question: ChoiceQuestion): Promise<string> {
    const values = question.choices.map((choice) => choice.value)
    const check: Check = (value) => (values.includes(value) ? undefined : `choose one of ${values.join(', ')}`)
    const passed = this.passed(question, check)
    if (passed !== undefined) return passed
    if (this.prompter === undefined) return question.fallback

    for (;;) {
      const answer = await this.prompter.choose(question.question, question.choices, question.fallback)
      const problem = check(answer)
      if (problem === undefined) return answer
      this.prompter.note(`  ${problem}`)
    }
  }
}

/** `base`, or the first of `base-2`, `base-3`, ... that is not taken. */
export const uniqueId = (base: string, taken: ReadonlySet<string>): string => {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
}

/** Environment variable names only: a value pasted where a name belongs is refused, never written. */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

export const checkEnvName: Check = (value) =>
  ENV_NAME.test(value)
    ? undefined
    : 'give the name of an environment variable (letters, digits and "_"), never its value'

export const checkUrl =
  (protocols: readonly string[]): Check =>
  (value) => {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      return 'not a URL'
    }
    const protocol = url.protocol.slice(0, -1)
    if (!protocols.includes(protocol)) return `use one of these schemes: ${protocols.join(', ')}`
    // Credentials belong in an environment variable, never in the file.
    if (url.username !== '' || url.password !== '') {
      return 'leave credentials out of the URL; name the environment variable that holds them instead'
    }
    return undefined
  }

export const checkPort: Check = (value) => {
  const port = Number(value)
  return /^\d+$/.test(value) && port >= 1 && port <= 65535 ? undefined : 'a port number from 1 to 65535'
}

export const checkNonBlank: Check = (value) => (value.trim() === '' || /\s/.test(value) ? 'no spaces' : undefined)
