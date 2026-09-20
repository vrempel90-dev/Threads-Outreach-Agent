export class OwnerNotifier {
  constructor(private readonly token:string,private readonly chatId:string){}
  get enabled(){return Boolean(this.token&&this.chatId)}
  async send(text:string){
    if(!this.enabled)return;
    const res=await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:this.chatId,text,disable_web_page_preview:true})});
    if(!res.ok) console.error(JSON.stringify({level:'warn',event:'telegram_notify_failed',status:res.status}));
  }
}
