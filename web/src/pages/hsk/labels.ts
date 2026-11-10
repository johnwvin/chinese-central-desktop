// English navigation labels; the official Chinese names remain visible too.
const LABELS: Record<string, string> = {
  "语素": "Morphemes", "前缀": "Prefixes", "后缀": "Suffixes", "类前缀": "Prefix-like elements", "类后缀": "Suffix-like elements",
  "词类": "Word classes", "名词": "Nouns", "方位名词": "Location nouns", "动词": "Verbs", "能愿动词": "Modal verbs", "离合词": "Separable words",
  "代词": "Pronouns", "疑问代词": "Question pronouns", "人称代词": "Personal pronouns", "指示代词": "Demonstratives", "数量代词": "Quantity pronouns",
  "数词": "Numerals", "量词": "Measure words", "名量词": "Noun measure words", "动量词": "Action measure words", "时量词": "Time measure words", "复合量词": "Compound measure words",
  "副词": "Adverbs", "程度副词": "Degree adverbs", "范围副词": "Scope adverbs", "时间副词": "Time adverbs", "频率副词": "Frequency adverbs", "关联副词": "Connecting adverbs", "否定副词": "Negative adverbs", "方式副词": "Manner adverbs", "情态副词": "Modal adverbs", "语气副词": "Attitude adverbs", "判断副词": "Judgment adverbs",
  "介词": "Prepositions", "引出时间、处所": "Introducing time or place", "引出对象": "Introducing an object", "引出方向、路径": "Introducing direction or route", "引出凭借、依据": "Introducing means or basis", "引出施事、受事": "Introducing agent or patient", "引出目的、原因": "Introducing purpose or cause", "引出原因": "Introducing cause", "表示排除": "Exclusion",
  "连词": "Conjunctions", "连接词语或短语": "Joining words or phrases", "连接词或短语": "Joining words or phrases", "连接词或者短语": "Joining words or phrases", "连接词或词组": "Joining words or phrases", "连接分句或句子": "Joining clauses or sentences", "连接分句或者句子": "Joining clauses or sentences", "连接词或词组以及分句或句子": "Joining words, phrases, clauses or sentences",
  "助词": "Particles", "结构助词": "Structural particles", "动态助词": "Aspect particles", "语气助词": "Sentence particles", "其他助词": "Other particles", "叹词": "Interjections", "形容词": "Adjectives",
  "短语": "Phrases", "结构类型": "Phrase structure", "基本结构类型": "Basic phrase structures", "其他结构类型": "Other phrase structures", "固定短语": "Fixed phrases", "四字格": "Four-character patterns", "固定格式": "Fixed patterns", "其他": "Other patterns", "其他（话语标记）": "Discourse markers",
  "句子成分": "Sentence elements", "主语": "Subjects", "谓语": "Predicates", "宾语": "Objects", "定语": "Attributives", "状语": "Adverbials", "补语": "Complements", "数量补语": "Quantity complements", "结果补语": "Result complements", "趋向补语": "Directional complements", "可能补语": "Potential complements", "程度补语": "Degree complements", "状态补语": "State complements",
  "句子的类型": "Sentence types", "句型": "Sentence structure", "单句": "Simple sentences", "句类": "Sentence functions", "疑问句": "Questions", "祈使句": "Commands", "特殊句型": "Special sentence patterns", "特殊句式": "Special sentence patterns", "功能类型": "Functional types",
  "“是”字句": "Sentences with 是", "“有”字句": "Sentences with 有", "“把”字句": "Sentences with 把", "“是……的”句": "是……的 sentences", "存现句": "Existential sentences", "连动句": "Serial-verb sentences", "兼语句": "Pivotal sentences", "双宾语句": "Double-object sentences", "比较句": "Comparisons", "被动句": "Passive sentences", "反问句": "Rhetorical questions", "重动句": "Verb-copying sentences", "双重否定句": "Double negation",
  "复句": "Complex sentences", "简单复句": "Two-clause sentences", "并列复句": "Coordinate clauses", "选择复句": "Alternative clauses", "转折复句": "Contrasting clauses", "因果复句": "Cause and effect", "紧缩复句": "Condensed clauses", "条件复句": "Conditional clauses", "假设复句": "Hypothetical clauses", "递进复句": "Progressive clauses", "承接复句": "Sequential clauses", "让步复句": "Concessive clauses", "目的复句": "Purpose clauses", "解说复句": "Explanatory clauses", "多重复句": "Multi-clause sentences",
  "动作的态": "Aspect", "进行态": "Progressive aspect", "完成态": "Perfective aspect", "持续态": "Continuing states", "经历态": "Experiential aspect", "变化态": "Changes of state",
  "特殊表达法": "Special expressions", "数的表达法": "Expressing numbers", "数的表示法": "Expressing numbers", "时间表示法": "Expressing time", "动词重叠": "Verb reduplication", "形容词重叠": "Adjective reduplication", "量词重叠": "Measure-word reduplication", "语段（句群）": "Connected discourse",
};

export function grammarLabel(value: string): string {
  const base = value.replace(/\d+$/, "");
  const number = value.slice(base.length);
  return (LABELS[base] ?? base) + (number ? ` ${number}` : "");
}
