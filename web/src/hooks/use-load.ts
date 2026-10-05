import {useCallback,useEffect,useRef,useState} from 'react';
import {request} from '../lib/http';

export function useLoad<T>(path:string){
  const [data,setData]=useState<T>();
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const requestSequence=useRef(0);
  const load=useCallback(async()=>{
    const sequence=++requestSequence.current;
    setLoading(true);
    setError('');
    try{
      const result=await request<T>(path);
      if(sequence===requestSequence.current)setData(result);
      return result;
    }catch(error:unknown){
      if(sequence===requestSequence.current)setError(error instanceof Error?error.message:'Request failed.');
      return undefined;
    }finally{
      if(sequence===requestSequence.current)setLoading(false);
    }
  },[path]);
  useEffect(()=>{void load();},[load]);
  return {data,error,loading,reload:load};
}
