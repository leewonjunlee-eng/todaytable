import { db } from './db';
import { apiUser, type AuthUser } from './auth';
export type Operator = AuthUser & { display_name: string; team_role: 'OWNER'|'OPERATOR'; avatar_color: string };
export async function requestOperator(request: Request): Promise<Operator|null> {
 const user=await apiUser(request,true); if(!user)return null;
 const row=await db.query<any>('SELECT display_name,team_role,avatar_color FROM operator_profiles WHERE user_id=$1 AND active=true',[user.id]);
 return row.rowCount?{...user,...row.rows[0]}:null;
}
export const parseJson = <T>(v: unknown,fallback:T): T => {try {return typeof v==='string'?JSON.parse(v):(v??fallback) as T;} catch {return fallback;}};
export function problem(message:string,status=400):never {throw Object.assign(new Error(message),{status});}
export function errorResponse(error:unknown) {
 const status=typeof error==='object'&&error&&'status' in error?Number(error.status):500;
 if(status===500) console.error(error);
 return Response.json({error:status===500?'처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.':error instanceof Error?error.message:'요청을 확인해 주세요.'},{status});
}
