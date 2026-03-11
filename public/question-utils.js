export function getQuestionDisplayParts(questionConfig = {}) {
  const header = typeof questionConfig.header === 'string' ? questionConfig.header : '';
  const question = typeof questionConfig.question === 'string' ? questionConfig.question : '';

  const normalizedHeader = header.trim();
  const normalizedQuestion = question.trim();
  const shouldHideHeader = normalizedHeader && normalizedHeader === normalizedQuestion;

  return {
    header: shouldHideHeader ? '' : header,
    question,
  };
}

if (typeof window !== 'undefined') {
  window.getQuestionDisplayParts = getQuestionDisplayParts;
}
