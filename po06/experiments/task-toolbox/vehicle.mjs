// Experimental task asset, not a domain template injected into the product.
export function createVehicle(THREE, p) {
  const root = new THREE.Group(); root.name = 'vehicle'
  const parts = new Map()
  const paint = new THREE.MeshPhysicalMaterial({color:p.paint,metalness:.8,roughness:.24,clearcoat:1,clearcoatRoughness:.13})
  const black = new THREE.MeshStandardMaterial({color:0x151c24,metalness:.3,roughness:.48})
  const rubber = new THREE.MeshStandardMaterial({color:0x101214,roughness:.85})
  const silver = new THREE.MeshStandardMaterial({color:0x9eacb8,metalness:.93,roughness:.28})
  const glass = new THREE.MeshPhysicalMaterial({color:0x102331,metalness:.5,roughness:.13,clearcoat:1})
  function add(name,geometry,material,pos=[0,0,0],parent=root) {
    const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.position.set(...pos);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);parts.set(name,mesh);return mesh
  }
  function loft(name,rings,material) {
    const positions=[],indices=[],n=8
    for(const [x,width,bottom,top] of rings){
      for(const [z,y] of [[-.75*width,bottom],[-width,bottom+.12],[-width,top-.12],[-.68*width,top],[.68*width,top],[width,top-.12],[width,bottom+.12],[.75*width,bottom]])positions.push(x,y,z)
    }
    for(let ring=0;ring<rings.length-1;ring++)for(let j=0;j<n;j++){
      const a=ring*n+j,b=ring*n+(j+1)%n,c=(ring+1)*n+j,d=(ring+1)*n+(j+1)%n
      indices.push(a,b,c,b,d,c)
    }
    for(let j=1;j<n-1;j++){indices.push(0,j+1,j);const a=(rings.length-1)*n;indices.push(a,a+j,a+j+1)}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setIndex(indices);geo.computeVertexNormals()
    // Keep the declared ring winding inspectable from either side in this small trial.
    material.side=THREE.DoubleSide
    return add(name,geo,material)
  }
  const L=p.body.length,W=p.body.width/2
  loft('body',[[ -L/2,.65*W,.36,.63],[-L*.36,.98*W,.28,.82],[-L*.1,W,.28,.92],[L*.16,.98*W,.3,.78],[L*.38,.85*W,.37,.64],[L/2,.62*W,.42,.56]],paint)
  loft('canopy',[[-L*.24,.60*W,.77,.83],[-L*.14,.62*W,.77,1.23],[L*.02,.57*W,.75,1.25],[L*.2,.47*W,.70,.74]],glass)
  add('front-splitter',new THREE.BoxGeometry(.55,.065,p.body.width*1.04),black,[-L/2+.24,.29,0])
  add('rear-diffuser',new THREE.BoxGeometry(.6,.15,p.body.width*.8),black,[L/2-.22,.32,0])
  const head=new THREE.MeshStandardMaterial({color:0xc7efff,emissive:0x8bc9e7,emissiveIntensity:1.2})
  const tail=new THREE.MeshStandardMaterial({color:0x710c15,emissive:0xd20c21,emissiveIntensity:1.3})
  for(const side of [-1,1]){
    add('headlight-'+side,new THREE.BoxGeometry(.035,.045,.4),head,[-L/2-.006,.56,side*W*.55])
    add('taillight-'+side,new THREE.BoxGeometry(.035,.045,.65),tail,[L/2+.008,.55,side*W*.4])
    add('sill-'+side,new THREE.BoxGeometry(L*.61,.12,.12),black,[0,.3,side*W])
    add('intake-'+side,new THREE.BoxGeometry(.55,.24,.025),black,[L*.13,.6,side*W*.99])
    const mirror=add('mirror-'+side,new THREE.SphereGeometry(.13,16,10),paint,[-.27,1.01,side*W*.84]);mirror.scale.set(1,.42,.65)
  }
  for(const axle of [-1,1])for(const side of [-1,1]){
    const name=(axle<0?'front':'rear')+'-'+(side<0?'left':'right')
    const wheel=new THREE.Group();wheel.name='wheel-'+name;wheel.position.set(axle*p.wheel.base/2,p.wheel.radius,side*p.wheel.track/2);root.add(wheel);parts.set(wheel.name,wheel)
    const tire=add('tire-'+name,new THREE.CylinderGeometry(p.wheel.radius,p.wheel.radius,p.wheel.width,48,1),rubber,[0,0,0],wheel);tire.rotation.x=Math.PI/2
    const face=add('rim-'+name,new THREE.CylinderGeometry(p.wheel.radius*.72,p.wheel.radius*.72,.045,36),silver,[0,0,side*p.wheel.width*.53],wheel);face.rotation.x=Math.PI/2
    const hub=add('hub-'+name,new THREE.CylinderGeometry(.09,.09,.06,16),black,[0,0,side*p.wheel.width*.62],wheel);hub.rotation.x=Math.PI/2
    for(let i=0;i<7;i++){
      const a=i*Math.PI*2/7;const spoke=add('spoke-'+name+'-'+i,new THREE.BoxGeometry(.055,p.wheel.radius*1.3,.055),black,[0,0,side*p.wheel.width*.61],wheel);spoke.rotation.z=a
    }
    add('brake-'+name,new THREE.BoxGeometry(.09,.23,.065),new THREE.MeshStandardMaterial({color:0xf16c21}),[.2,.05,side*p.wheel.width*.58],wheel)
  }
  add('wing',new THREE.BoxGeometry(.44,.07,p.wing.span),black,[L*.36,p.wing.height,0])
  for(const side of [-1,1])add('wing-mount-'+side,new THREE.BoxGeometry(.09,Math.max(.1,p.wing.height-.75),.065),silver,[L*.36,(p.wing.height+.75)/2,side*.6])
  root.updateMatrixWorld(true)
  return {root,parts}
}

export function renderPage(THREE, createVehicle, spec) {
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x111a26)
  const vehicle=createVehicle(THREE,spec);scene.add(vehicle.root)
  scene.add(new THREE.HemisphereLight(0xc7e4ff,0x283344,2.3))
  for(const [position,color,intensity]of [[[ -3,6,4],0xc8e5ff,4.4],[[3,4,-5],0xffcd91,3],[[0,2,5],0xffffff,1]]){
    const light=new THREE.DirectionalLight(color,intensity);light.position.set(...position);scene.add(light)
  }
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:0x243144,roughness:.66,metalness:.25}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor)
  const grid=new THREE.GridHelper(18,36,0x44566c,0x2b3b51);grid.position.y=.005;scene.add(grid)
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(1);renderer.setSize(innerWidth,innerHeight);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;document.body.appendChild(renderer.domElement)
  const camera=new THREE.PerspectiveCamera(37,innerWidth/innerHeight,.1,200)
  const views={hero:[-7,3.6,7],side:[0,1.9,9.6],front:[-9,1.8,0],top:[0,10,.001],rear:[8,2.4,5]}
  function view(name){camera.position.set(...(views[name]||views.hero));camera.lookAt(0,.55,0);renderer.render(scene,camera);return name}
  view('hero');window.__toolbox={view,rendererInfo:()=>({renderer:renderer.getContext().getParameter(renderer.getContext().RENDERER),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles}),ready:true}
  const label=document.createElement('div');label.id='label';label.textContent='THREE.JS / TASK TOOLBOX / '+spec.version;document.body.appendChild(label)
  const buttons=document.createElement('div');buttons.id='views';for(const name of Object.keys(views)){const b=document.createElement('button');b.textContent=name;b.onclick=()=>view(name);buttons.appendChild(b)}document.body.appendChild(buttons)
  let down=false,x=0,angle=0;renderer.domElement.onpointerdown=e=>{down=true;x=e.clientX};window.onpointerup=()=>down=false;window.onpointermove=e=>{if(!down)return;angle+=(e.clientX-x)*.01;x=e.clientX;camera.position.set(-9*Math.cos(angle),3.3,9*Math.sin(angle));camera.lookAt(0,.55,0);renderer.render(scene,camera)}
  window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.render(scene,camera)})
}
