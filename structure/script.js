// fully reworked bonk prototype

(() => {
  const {
    Engine, Render, Runner, World, Bodies, Body,
    Events, Vector, Composite, Query, Constraint
  } = Matter;

  const engine = Engine.create();
  const world = engine.world;
  world.gravity.y = 1;

  const canvas = document.getElementById("canvas");
  canvas.width = innerWidth;
  canvas.height = innerHeight;

  const render = Render.create({
    canvas,
    engine,
    options:{
      width:innerWidth,
      height:innerHeight,
      wireframes:false,
      background:"#efefef"
    }
  });

  Render.run(render);
  const runner = Runner.create();
  Runner.run(runner, engine);

  // --------------------------------------------------
  // scene
  // --------------------------------------------------
  const ground = Bodies.rectangle(innerWidth/2, innerHeight-40, innerWidth, 80, {
    isStatic:true,
    label:"grapplable",
    render:{ fillStyle:"#ccc" }
  });

  const platforms = [
    Bodies.rectangle(300, innerHeight-180, 400, 20, { isStatic:true, label:"grapplable", render:{fillStyle:"#cfcfcf"} }),
    Bodies.rectangle(innerWidth-300, innerHeight-280, 380, 20, { isStatic:true, label:"grapplable", angle:-0.05, render:{fillStyle:"#cfcfcf"} }),
    Bodies.rectangle(600, innerHeight-460, 260, 18, { isStatic:true, label:"grapplable", angle:0.1, render:{fillStyle:"#cfcfcf"} })
  ];

  World.add(world, [ground, ...platforms]);

  // --------------------------------------------------
  // player
  // --------------------------------------------------
  const player = Bodies.circle(200, innerHeight-300, 22, {
    frictionAir:0.045,
    friction:0.002,
    restitution:0.2,
    density:0.002,
    label:"player",
    render:{ fillStyle:"#222" }
  });

  World.add(world, player);

  // ground detection
  let onGround = false;
  Events.on(engine, "collisionStart", e=>{
    for(const pair of e.pairs){
      if(pair.bodyA===player || pair.bodyB===player){
        const other = pair.bodyA===player ? pair.bodyB : pair.bodyA;
        if(other.isStatic) onGround = true;
      }
    }
  });
  Events.on(engine, "collisionEnd", e=>{
    for(const pair of e.pairs){
      if(pair.bodyA===player || pair.bodyB===player){
        const other = pair.bodyA===player ? pair.bodyB : pair.bodyA;
        if(other.isStatic) onGround = false;
      }
    }
  });

  // --------------------------------------------------
  // movement
  // --------------------------------------------------
  const keys = {a:false,d:false};

  addEventListener("keydown", e=>{
    const k = e.key.toLowerCase();
    if(k==="a") keys.a=true;
    if(k==="d") keys.d=true;

    if(k==="w" || e.code==="Space"){
      if(onGround){
        Body.setVelocity(player, {x:player.velocity.x, y:-9});
      }
    }

    if(k==="1") setMode("classic");
    if(k==="2") setMode("arrows");
  });

  addEventListener("keyup", e=>{
    if(e.key.toLowerCase()==="a") keys.a=false;
    if(e.key.toLowerCase()==="d") keys.d=false;
  });

  // slow, smooth, bonk-ish movement
  Events.on(engine, "beforeUpdate", ()=>{
    const f = 0.009; // smaller = slower
    if(keys.a && !keys.d)
      Body.applyForce(player, player.position, {x:-f, y:0});
    else if(keys.d && !keys.a)
      Body.applyForce(player, player.position, {x:f, y:0});
    else
      Body.setVelocity(player, {x:player.velocity.x*0.97, y:player.velocity.y});
  });

  // --------------------------------------------------
  // grapple
  // --------------------------------------------------
  let grapple = null;
  let mode = "classic";

  function nearestVertex(body, point){
    let min=1e12, best=null;
    for(const v of body.vertices){
      const dx=v.x-point.x, dy=v.y-point.y;
      const d=dx*dx+dy*dy;
      if(d<min){ min=d; best=v; }
    }
    return best;
  }

  function makeGrapple(point){
    const bodies = Query.point(Composite.allBodies(world), point)
      .filter(b => b.label==="grapplable");

    if(bodies.length===0) return;

    const b = bodies[0];
    const v = nearestVertex(b, point);

    if(grapple)
      Composite.remove(world, grapple);

    grapple = Constraint.create({
      bodyA:player,
      pointB:{x:v.x, y:v.y},
      stiffness:0.0015,
      length: Vector.magnitude(Vector.sub(player.position, v)) * 0.9, // little slack
      damping:0.015,
      render:{ strokeStyle:"#111", lineWidth:3 }
    });

    Composite.add(world, grapple);
  }

  function dropGrapple(){
    if(grapple){
      Composite.remove(world, grapple);
      grapple=null;
    }
  }

  canvas.addEventListener("mousedown", e=>{
    const r = canvas.getBoundingClientRect();
    const pos = {
      x:(e.clientX - r.left)*(canvas.width/r.width),
      y:(e.clientY - r.top)*(canvas.height/r.height)
    };

    if(mode==="classic"){
      makeGrapple(pos);
    } else if(mode==="arrows"){
      shootArrow(pos);
    }
  });

  canvas.addEventListener("mouseup", e=>{
    if(mode==="classic") dropGrapple();
  });

  // --------------------------------------------------
  // arrows
  // --------------------------------------------------
  function shootArrow(target){
    const dir = Vector.normalise(Vector.sub(target, player.position));
    const arrow = Bodies.rectangle(
      player.position.x + dir.x*28,
      player.position.y + dir.y*28,
      40,6,
      {
        label:"arrow",
        frictionAir:0.02,
        density:0.0008,
        render:{ fillStyle:"#111" }
      }
    );

    Body.setVelocity(arrow, {x:dir.x*25, y:dir.y*25});
    World.add(world, arrow);

    // rotate arrow to face velocity
    Events.on(engine, "afterUpdate", ()=>{
      if(!arrow.isStatic){
        const v = arrow.velocity;
        if(v.x!==0 || v.y!==0)
          Body.setAngle(arrow, Math.atan2(v.y, v.x));
      }
    });

    // explode after 5s
    setTimeout(()=>{
      if(Composite.get(world, arrow.id, "body")){
        explode(arrow.position, 150);
        World.remove(world, arrow);
      }
    }, 5000);
  }

  function explode(pos, power){
    const bodies = Composite.allBodies(world);
    for(const b of bodies){
      if(!b.isStatic){
        const dir = Vector.sub(b.position, pos);
        const dist = Math.max(20, Vector.magnitude(dir));
        const f = power/(dist*dist);
        Body.applyForce(b, b.position, {
          x:dir.x/dist*f,
          y:dir.y/dist*f
        });
      }
    }
  }

  // --------------------------------------------------
  // mode ui
  // --------------------------------------------------
  const classicBtn = document.getElementById("classic-btn");
  const arrowsBtn = document.getElementById("arrows-btn");

  function setMode(m){
    mode = m;
    if(m==="classic"){
      classicBtn.classList.add("active");
      arrowsBtn.classList.remove("active");
      dropGrapple();
    } else {
      arrowsBtn.classList.add("active");
      classicBtn.classList.remove("active");
      dropGrapple();
    }
  }

  classicBtn.onclick = ()=>setMode("classic");
  arrowsBtn.onclick = ()=>setMode("arrows");

})();
