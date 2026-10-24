export async function errorText(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const body = JSON.parse(text);
    return body.error ?? body.message ?? text;
  } catch {
    return text || `HTTP ${res.status}`;
  }
}
