class AutomaticSync {
 constructor(options){this.options=options;this.timer=null;this.running=false;this.pending=false;this.disposed=false;}
 schedule(){if(this.disposed)return;this.pending=true;if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=null;this.run();},this.options.delay??500);}
 async run(){if(this.disposed||this.running||!this.options.active())return;this.pending=false;this.running=true;try{const snapshot=await this.options.capture();if(!this.disposed&&this.options.active())await this.options.apply(snapshot);}catch(e){if(!this.disposed&&e.name!=='AbortError')this.options.error(e);}finally{this.running=false;if(this.pending&&!this.disposed)this.schedule();}}
 cancel(){if(this.timer)clearTimeout(this.timer);this.timer=null;this.pending=false;}
 stop(){this.cancel();this.disposed=true;}
}
module.exports={AutomaticSync};
