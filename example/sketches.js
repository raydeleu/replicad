function main({Sketcher,Sketch})
{
// Parameters

let length      = 100;
let width       = 40;
let height      = 20;
let r           = 15;
let r_ends      = 2;

// movePointerTo([x,y])
// lineTo([x,y])
// line(dx,dy)
// vLineTo(y)
// vline(dy)
// hlineTo(x)
// hline(dx)
// polarLineTo([radius,theta])
// polarLine(distance,angle)
// tangentLine(distance)
// threePointsArcTo(point_end,point_mid)
// threePointsArc(dx,dy,dx_via,dy_via)
// sagittaArcTo(point_end,sagitta)
// sagittaArc(dx,dy,sagitta)
// vSagittaArc(dy,sagitta)
// hSagittaArc(dx,sagitta)
// tangentArcTo([x,y])
// tangentArc(dx,dy)
// ellipseTo([x,y],r_hor,r_vert)
// ellipse(dx,dy,r_hor,r_vert)
// halfEllipseTo([x,y],r_min)
// halfEllipse(dx,dy,r_min)
// bezierCurveTo([x,y],points[])
// quadraticBezierCurveTo([x,y],[x_ctrl,y_ctrl])
// cubicBezierCurveTo([x,y],p_ctrl_start,p_ctrl_end)
// smoothSplineTo([x,y],splineconfig)
// smoothSpline(dx,dy,splineconfig)

let planView = new Sketcher().hLine(length-2*r).tangentArc(r,r).vLine(width-2*r).tangentArc(-0.75*r,r).line(-length*1.5+2*r,2*r).tangentArc(-r,-r).vLine(-width+2*r).tangentArc(r,-r).close().extrude(height).fillet(r_ends)

let planViewXZ = new Sketcher("XZ").hLine(length).vLine(width).line(-length*1.5+2*r,2*r).vLine(-width).close().extrude(height)
.fillet(r, (e)=>e.inDirection("Y"))
.fillet(r_ends, (e)=>e.inPlane("XZ"))
.fillet(r_ends, (e)=>e.inPlane("XZ",height))

let testSagittaArc = new Sketcher("XZ")
.hLine(10).hSagittaArc(50,-25).hLine(10).vLine(30).hLine(-70).close().extrude(20)

let p0 = [0,0]
let p1 = [50,100]
let p2 = [60,-95]
let p3 = [80,30]
let p4 = [100,25]
// let points = []
// points.push(p1)
// points.push(p2)
// points.push(p3)
// points.push(p4)
let points = [p1,p2,p3,p4]

let testBezier = new Sketcher("XZ")
.movePointerTo(p0).bezierCurveTo(p4,points).vLine(-50).hLine(-100).close().extrude(30)
let testBezier1 = testBezier.clone()
let block = new Sketcher("XZ")
.hLine(100).vLine(50).hLine(-100).close().extrude(30)
let mollino = block.cut(testBezier)
mollino = mollino.intersect(testBezier1.translate([0,0,5]))

// let crossSection = new Sketcher("XY")
// .hLine(30)
// .vLine(5)
// .hLine(-30)
// .close()
// testBezier1 = new Sketch()
// testBezier.sweepSketch(crossSection)

// testBezier = Offset(testBezier,10)



return [planView,planViewXZ,testSagittaArc,mollino]

} 
