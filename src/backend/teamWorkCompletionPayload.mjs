export function mergeTeamWorkCompletionDetailPayload(workCompletion, workCompletionDetail) {
  if (!workCompletion) {
    return null;
  }
  if (workCompletionDetail) {
    return {
      ...workCompletion,
      ...workCompletionDetail,
      detailReady: true,
      detailStatus: 'ready',
    };
  }
  return {
    ...workCompletion,
    detailReady: false,
    detailStatus: 'missing',
  };
}
