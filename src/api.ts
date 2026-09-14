type RequestOptions = {
  body?: unknown;
  headers?: Record<string, string>;
};

async function request<T = unknown>(method: string, url: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
  });

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const message = typeof data === 'object' && data && 'error' in data
      ? String((data as Record<string, unknown>).error)
      : text || `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return data as T;
}

export const api = {
  get: <T = unknown>(url: string) => request<T>('GET', url),
  post: <T = unknown>(url: string, body?: unknown) => request<T>('POST', url, { body }),
  put: <T = unknown>(url: string, body?: unknown) => request<T>('PUT', url, { body }),
  patch: <T = unknown>(url: string, body?: unknown) => request<T>('PATCH', url, { body }),
  delete: <T = unknown>(url: string) => request<T>('DELETE', url),
};
