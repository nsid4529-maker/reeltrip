import {boundedText} from './http-safety.ts';

// Count bytes while streaming: Content-Length may be absent or dishonest.
export async function readRequestBody(request:Request,limit:number):Promise<string>{
 return boundedText(request,limit,10000);
}
