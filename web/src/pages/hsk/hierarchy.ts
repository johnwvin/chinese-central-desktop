export interface GrammarNode { id: string; path: string[] }

export function grammarGroup<T extends GrammarNode>(entries: readonly T[], prefix: readonly string[]) {
  const branch = entries.filter((entry) => prefix.every((part, index) => entry.path[index] === part));
  const names = [...new Set(branch.filter((entry) => entry.path.length > prefix.length + 1)
    .map((entry) => entry.path[prefix.length]))];
  return {
    categories: names.map((name) => ({ name, count: branch.filter((entry) => entry.path[prefix.length] === name).length })),
    entries: branch.filter((entry) => entry.path.length <= prefix.length + 1 && !names.includes(entry.path[prefix.length])),
  };
}

const DESCRIPTIONS: Record<string, string> = {
  "语素": "Meaningful word parts that combine with a base to form or modify a word.",
  "词类": "Classes of words grouped by their grammatical properties and functions.",
  "短语": "Combinations of words that form a unit within a sentence.",
  "句子成分": "The roles units play in a sentence: subject, predicate, object, modifier, and complement.",
  "句子的类型": "Sentence structures and types, including questions, commands, and sentences with multiple clauses.",
  "动作的态": "Ways of presenting an action or state as completed, ongoing, continuing, experienced, or changed.",
  "特殊表达法": "Conventional expressions for numbers, quantities, and time.",
  "固定格式": "Established grammatical patterns with a conventional arrangement of words.",
  "名词": "Words that name people, places, things, and concepts, including location nouns.",
  "动词": "Words that express actions, events, states, or modal meanings.",
  "代词": "Words that refer to people, things, quantities, or choices without repeating a full noun phrase.",
  "数词": "Words used to express numbers and quantities.",
  "量词": "Units used with numbers or demonstratives to count nouns or occurrences of actions.",
  "副词": "Words that modify a predicate or clause to express degree, time, frequency, scope, manner, or stance.",
  "介词": "Words introducing phrases that specify relations such as time, place, direction, cause, or participant.",
  "连词": "Words connecting words, phrases, or clauses and expressing the relation between them.",
  "助词": "Function words marking grammatical structure, aspect, or speaker stance.",
  "形容词": "Words expressing qualities or states that can modify nouns or function as predicates.",
  "叹词": "Expressions of reactions, feelings, or responses, often standing outside the sentence structure.",
  "句型": "Structural patterns that organize sentence elements.",
  "句类": "Sentence types defined by communicative purpose, such as statements, questions, and commands.",
  "特殊句型": "Sentence constructions with specific word order or grammatical requirements.",
  "特殊句式": "Sentence constructions with specific word order or grammatical requirements.",
  "单句": "Sentences organized around one clause.",
  "复句": "Sentences linking clauses through relations such as cause, contrast, condition, or sequence.",
  "简单复句": "Sentences connecting clauses through a single main relationship.",
  "补语": "Elements following a predicate that specify result, direction, degree, possibility, duration, or quantity.",
  "结构类型": "Phrase types classified by how their component words relate to one another.",
  "固定短语": "Established expressions with conventional wording, structure, or meaning.",
  "功能类型": "Phrase types classified by the grammatical functions they can perform.",
};

export function grammarDescription(name: string, label: string) {
  return DESCRIPTIONS[name] ?? `Patterns and uses of ${label.toLowerCase()} within this grammar category.`;
}
