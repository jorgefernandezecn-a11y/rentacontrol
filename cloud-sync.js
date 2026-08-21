
const CLOUD = {
  online:false,
  syncing:false,
  lastError:null,
  async load(){
    try{
      const r=await fetch("/api/state",{cache:"no-store"});
      if(!r.ok) throw new Error(await r.text());
      const j=await r.json();
      this.online=true; this.lastError=null;
      return j.state;
    }catch(e){this.online=false;this.lastError=e;return null}
  },
  async save(state){
    if(this.syncing) return state;
    this.syncing=true;
    try{
      const r=await fetch("/api/state",{
        method:"PUT",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({state})
      });
      if(!r.ok) throw new Error(await r.text());
      const j=await r.json();
      this.online=true;this.lastError=null;
      return j.state;
    }catch(e){
      this.online=false;this.lastError=e;
      throw e;
    }finally{this.syncing=false}
  }
};
