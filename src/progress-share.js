export function progressOwnerLabel(name, noun) {
  const first = String(name || '').trim().split(/\s+/)[0];
  return first ? first + "'s " + noun : 'Your ' + noun;
}

export async function createProgressShareFile(progress, name) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image sharing is unavailable in this browser.');
  const bg = '#e3f0f8', ink = '#254e5d', secondary = '#66849d';
  ctx.fillStyle = bg; ctx.fillRect(0,0,1080,1350);
  function text(value,x,y,size,color=ink,weight=500) {
    ctx.fillStyle=color; ctx.font=weight+' '+size+'px Quicksand, sans-serif'; ctx.textAlign='center'; ctx.fillText(value,x,y,950);
  }
  text('S Y N Q . M E',540,90,30,ink,600);
  text(progressOwnerLabel(name,'progress'),540,172,48);
  const x=540,y=475,r=205;
  ctx.save(); ctx.shadowColor='#b9d5e5'; ctx.shadowBlur=32; ctx.shadowOffsetY=14;
  ctx.beginPath(); ctx.arc(x,y,r+42,0,Math.PI*2); ctx.fillStyle=bg; ctx.fill(); ctx.restore();
  ctx.lineWidth=60; ctx.strokeStyle='#cde3ee'; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.stroke();
  if(progress.percent>0) {
    const gradient=ctx.createLinearGradient(300,300,760,650); gradient.addColorStop(0,'#6cbfd1'); gradient.addColorStop(1,'#8e70d6');
    ctx.strokeStyle=gradient; ctx.lineCap='round'; ctx.beginPath(); ctx.arc(x,y,r,-Math.PI/2,-Math.PI/2+2*Math.PI*progress.percent/100); ctx.stroke();
  }
  text(progress.percent+'%',540,477,76,'#7756c6',700);
  text('scenarios complete',540,536,28,secondary);
  text(progress.completed+' of '+progress.total+' scenarios confirmed complete',540,790,27,secondary);
  const colors=['#65bfd0','#8870d8','#efb567','#df8bc4'];
  progress.groups.forEach((group,i)=>{
    const cx=210+i*220, top=870, height=250, width=76;
    ctx.fillStyle='#cfe4ef'; ctx.beginPath(); ctx.roundRect(cx-width/2,top,width,height,38); ctx.fill();
    if(group.percent>0) {
      const fill=Math.max(8,height*group.percent/100);
      ctx.fillStyle=colors[i];ctx.beginPath();ctx.roundRect(cx-width/2,top+height-fill,width,fill,Math.min(38,fill/2));ctx.fill();
    }
    text(group.label,cx,1173,26,secondary);text(group.completed+'/'+group.total,cx,1218,31,ink,700);
  });
  text('Building a personal SecondSelf with MySecondSelf',540,1302,22,secondary);
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Could not create the progress image.')),'image/png'));
  return new File([blob],'synqme-progress.png',{type:'image/png'});
}

export async function shareProgressImage(progress,name) {
  const file=await createProgressShareFile(progress,name);
  if(navigator.canShare?.({files:[file]})) {
    try { await navigator.share({files:[file],title:progressOwnerLabel(name,'SYNQ.ME progress')});return 'shared'; }
    catch(error) { if(error.name==='AbortError') return 'cancelled'; }
  }
  const url=URL.createObjectURL(file), link=document.createElement('a');
  link.href=url;link.download=file.name;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  return 'downloaded';
}
