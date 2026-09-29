export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'ServiceEfficiency',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError('เชื่อมต่อ API ไม่สำเร็จ กรุณาลองใหม่', 0);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login')
      window.dispatchEvent(new Event('auth-expired'));
    const message = data?.message;
    throw new ApiError(
      Array.isArray(message)
        ? message.join(', ')
        : typeof message === 'string'
          ? message
          : 'ทำรายการไม่สำเร็จ',
      response.status,
    );
  }
  return data as T;
}
