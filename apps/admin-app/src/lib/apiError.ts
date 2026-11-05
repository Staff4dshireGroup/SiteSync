export function messageFromError(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: { error?: string; block_reasons?: { message?: string }[] } } })?.response
    ?.data;
  const reasons = data?.block_reasons?.map((reason) => reason.message).filter((message): message is string => Boolean(message));
  if (reasons && reasons.length > 0) return reasons.join('\n');
  if (data?.error) return data.error;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
