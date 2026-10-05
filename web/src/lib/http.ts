const API = import.meta.env.VITE_API_URL ?? '';

export async function request<T>(path:string, init:RequestInit = {}):Promise<T> {
  const token=localStorage.getItem('token');
  const response=await fetch(`${API}${path}`,{
    ...init,
    headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{ }),...init.headers},
  });

  if(response.status===401){
    localStorage.removeItem('token');
    if(!path.includes('/auth/'))location.assign('/login');
  }
  if(!response.ok){
    const problem:unknown=await response.json().catch(()=>null);
    const detail=typeof problem==='object'&&problem!==null&&'detail' in problem&&typeof problem.detail==='string'?problem.detail:undefined;
    throw new Error(detail??`Request failed (${response.status})`);
  }
  if(response.status===204)return undefined as T;
  const body:unknown=await response.json();
  return body as T;
}
