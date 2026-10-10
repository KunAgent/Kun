import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
export type GuestSession={guestId:string;credential:string;expiresAt:string}
export function guestStorage(path:string) {
  return {
    async read():Promise<{installationId:string;session?:GuestSession}> {
      try {
        const v=JSON.parse(await readFile(path,'utf8'))
        if(typeof v.installationId==='string' && /^[a-f0-9-]{36}$/.test(v.installationId))return v
      } catch { /* Missing or corrupt guest credential: a new identity cannot inherit old tickets. */ }
      return {installationId:randomUUID()}
    },
    async write(value:{installationId:string;session?:GuestSession}) {
      await mkdir(dirname(path),{recursive:true,mode:0o700})
      const temp=path+'.'+randomUUID();await writeFile(temp,JSON.stringify(value),{mode:0o600});await rename(temp,path)
    }
  }
}
