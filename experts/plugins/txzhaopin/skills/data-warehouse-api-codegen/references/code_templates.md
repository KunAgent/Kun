# StarRocks 查询接口 - 代码模板

本文件包含各语言/框架调用 StarRocks 查询接口的标准代码模板。

## 接口常量

```
API_URL = https://dos-dataview-mcp.woa.com/api/query
METHOD = POST
Content-Type = application/json
```

---

## 1. JavaScript - fetch

### 基础调用

```javascript
async function queryStarRocks(sql) {
  const response = await fetch('https://dos-dataview-mcp.woa.com/api/query', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ sql }),
  });

  const result = await response.json();

  if (result.code === 0) {
    return result.data;
  } else {
    throw new Error(`查询失败: ${result.message}`);
  }
}

// 使用示例
try {
  const data = await queryStarRocks('SELECT * FROM your_table LIMIT 10');
  console.log('查询结果:', data);
} catch (error) {
  console.error('查询出错:', error.message);
}
```

### 带超时和重试的增强版

```javascript
async function queryStarRocks(sql, options = {}) {
  const { timeout = 30000, retries = 1 } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch('https://dos-dataview-mcp.woa.com/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sql }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const result = await response.json();

      if (result.code === 0) {
        return result.data;
      } else {
        throw new Error(`[code=${result.code}] ${result.message}`);
      }
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  throw lastError;
}
```

---

## 2. JavaScript - axios

### 基础调用

```javascript
import axios from 'axios';

async function queryStarRocks(sql) {
  const { data: result } = await axios.post('https://dos-dataview-mcp.woa.com/api/query', {
    sql,
  }, {
    withCredentials: true,
  });

  if (result.code === 0) {
    return result.data;
  } else {
    throw new Error(`查询失败: ${result.message}`);
  }
}

// 使用示例
try {
  const data = await queryStarRocks('SELECT * FROM your_table LIMIT 10');
  console.log('查询结果:', data);
} catch (error) {
  console.error('查询出错:', error.message);
}
```

### 封装为 axios 实例

```javascript
import axios from 'axios';

const starrocksClient = axios.create({
  baseURL: 'http://9.135.247.190:31800',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

// 响应拦截器：统一处理业务错误
starrocksClient.interceptors.response.use(
  (response) => {
    const { code, message, data } = response.data;
    if (code === 0) {
      return data;
    }
    return Promise.reject(new Error(`[code=${code}] ${message}`));
  },
  (error) => {
    if (error.code === 'ECONNABORTED') {
      return Promise.reject(new Error('请求超时，请稍后重试'));
    }
    return Promise.reject(error);
  }
);

export async function query(sql) {
  return starrocksClient.post('/api/query', { sql });
}
```

---

## 3. TypeScript - fetch（含类型定义）

```typescript
interface StarRocksResponse<T = Record<string, unknown>> {
  code: number;
  message: string;
  data: T[] | null;
}

interface QueryOptions {
  timeout?: number;
}

const API_URL = 'https://dos-dataview-mcp.woa.com/api/query';

async function queryStarRocks<T = Record<string, unknown>>(
  sql: string,
  options: QueryOptions = {}
): Promise<T[]> {
  const { timeout = 30000 } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ sql }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const result: StarRocksResponse<T> = await response.json();

    if (result.code === 0 && result.data) {
      return result.data;
    } else {
      throw new Error(`查询失败: ${result.message}`);
    }
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('查询超时');
    }
    throw error;
  }
}

// 使用示例
interface Employee {
  id: number;
  name: string;
  department: string;
}

const employees = await queryStarRocks<Employee>(
  'SELECT id, name, department FROM employees LIMIT 10'
);
```

---

## 4. React Hook 封装

```typescript
import { useState, useCallback } from 'react';

interface StarRocksResponse<T = Record<string, unknown>> {
  code: number;
  message: string;
  data: T[] | null;
}

interface UseStarRocksQueryResult<T> {
  data: T[] | null;
  loading: boolean;
  error: string | null;
  execute: (sql: string) => Promise<T[]>;
  reset: () => void;
}

const API_URL = 'https://dos-dataview-mcp.woa.com/api/query';

function useStarRocksQuery<T = Record<string, unknown>>(): UseStarRocksQueryResult<T> {
  const [data, setData] = useState<T[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (sql: string): Promise<T[]> => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sql }),
      });

      const result: StarRocksResponse<T> = await response.json();

      if (result.code === 0 && result.data) {
        setData(result.data);
        return result.data;
      } else {
        const errMsg = `查询失败: ${result.message}`;
        setError(errMsg);
        throw new Error(errMsg);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : '未知错误';
      setError(errMsg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  return { data, loading, error, execute, reset };
}

export default useStarRocksQuery;

// 使用示例
// function MyComponent() {
//   const { data, loading, error, execute } = useStarRocksQuery<{ id: number; name: string }>();
//
//   const handleQuery = () => {
//     execute('SELECT id, name FROM employees LIMIT 10');
//   };
//
//   if (loading) return <div>加载中...</div>;
//   if (error) return <div>错误: {error}</div>;
//   return (
//     <div>
//       <button onClick={handleQuery}>查询</button>
//       {data && <pre>{JSON.stringify(data, null, 2)}</pre>}
//     </div>
//   );
// }
```

---

## 5. Vue 3 Composable 封装

```typescript
import { ref } from 'vue';

interface StarRocksResponse<T = Record<string, unknown>> {
  code: number;
  message: string;
  data: T[] | null;
}

const API_URL = 'https://dos-dataview-mcp.woa.com/api/query';

export function useStarRocksQuery<T = Record<string, unknown>>() {
  const data = ref<T[] | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function execute(sql: string): Promise<T[]> {
    loading.value = true;
    error.value = null;

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sql }),
      });

      const result: StarRocksResponse<T> = await response.json();

      if (result.code === 0 && result.data) {
        data.value = result.data as any;
        return result.data;
      } else {
        const errMsg = `查询失败: ${result.message}`;
        error.value = errMsg;
        throw new Error(errMsg);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : '未知错误';
      error.value = errMsg;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  function reset() {
    data.value = null;
    error.value = null;
    loading.value = false;
  }

  return { data, loading, error, execute, reset };
}

// 使用示例
// <script setup>
// import { useStarRocksQuery } from './useStarRocksQuery';
// const { data, loading, error, execute } = useStarRocksQuery();
// const handleQuery = () => execute('SELECT * FROM your_table LIMIT 10');
// </script>
```
