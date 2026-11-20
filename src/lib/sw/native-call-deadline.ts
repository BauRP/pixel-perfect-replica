/** A single native callback must not freeze a serial Android command queue.
 * A timeout is an UNKNOWN native outcome, never an affirmative start/stop.
 */
export class NativeCallDeadlineExceeded extends Error {
  constructor(){super("Android не ответил на команду вовремя");this.name="NativeCallDeadlineExceeded";}
}
export async function withNativeDeadline<T>(work:()=>Promise<T>,timeoutMs:number):Promise<T>{
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120_000)
    throw new RangeError("Неверный лимит ожидания Android");
  let timeout:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_resolve,reject)=>{
    timeout=setTimeout(()=>reject(new NativeCallDeadlineExceeded()),timeoutMs);
  });
  try{return await Promise.race([Promise.resolve().then(work),deadline]);}
  finally{if(timeout!==undefined)clearTimeout(timeout);}
}
