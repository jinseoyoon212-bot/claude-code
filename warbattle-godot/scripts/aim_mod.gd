extends SkeletonModifier3D
## Runs after the animation: leans the spine with the aim pitch, crouches the legs and
## hides the head in first person. Bone space is the Mixamo rig (cm, +Z up, +Y forward).

var pitch := 0.0
var crouch := 0.0
var hide_head := false
var dead := 0.0
var b := {}
# hand targets in skeleton space, and how strongly to pull the hands onto them
var ik := 0.0
var r_target := Vector3.ZERO
var l_target := Vector3.ZERO


func setup(sk: Skeleton3D) -> void:
	for n in ["Hips", "Spine", "Spine1", "Spine2", "Neck", "LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot", "LeftArm", "RightArm", "LeftForeArm", "RightForeArm", "LeftHand", "RightHand"]:
		b[n] = sk.find_bone("mixamorig_" + n)


func _process_modification() -> void:
	var sk := get_skeleton()
	if sk == null or b.is_empty():
		return
	for n in ["Spine", "Spine1", "Spine2"]:
		var q := sk.get_bone_pose_rotation(b[n])
		sk.set_bone_pose_rotation(b[n], q * Quaternion(Vector3.RIGHT, -pitch / 3.0))
	if crouch > 0.01:
		var hp := sk.get_bone_pose_position(b.Hips)
		sk.set_bone_pose_position(b.Hips, hp - Vector3(0, 0, 40.0 * crouch))
		for side in ["Left", "Right"]:
			var k := crouch * (1.0 if side == "Left" else 0.8)
			_rot(sk, side + "UpLeg", -1.05 * k)
			_rot(sk, side + "Leg", 1.95 * k)
			_rot(sk, side + "Foot", -0.9 * k)
	if dead > 0.0:
		# go limp: arms drop away from the weapon pose
		_rot(sk, "LeftArm", 0.6 * dead)
		_rot(sk, "RightArm", 0.6 * dead)
		_rot(sk, "LeftForeArm", -0.4 * dead)
		_rot(sk, "RightForeArm", -0.4 * dead)
	if ik > 0.01 and dead <= 0.0:
		_ccd(sk, [b.RightForeArm, b.RightArm], b.RightHand, r_target)
		_ccd(sk, [b.LeftForeArm, b.LeftArm], b.LeftHand, l_target)
	if hide_head:
		sk.set_bone_pose_scale(b.Neck, Vector3.ONE * 0.001)


# Cyclic coordinate descent in skeleton space: rotate each joint so the hand points at the target.
func _ccd(sk: Skeleton3D, chain: Array, eff: int, target: Vector3) -> void:
	for it in 10:
		for j in chain:
			var jg := sk.get_bone_global_pose(j)
			var ep := sk.get_bone_global_pose(eff).origin
			var a := ep - jg.origin
			var t := target - jg.origin
			if a.length_squared() < 1e-6 or t.length_squared() < 1e-6:
				continue
			var q := Quaternion(a.normalized(), t.normalized())
			if ik < 0.999:
				q = Quaternion.IDENTITY.slerp(q, ik)
			var pg := sk.get_bone_global_pose(sk.get_bone_parent(j))
			var new_global := Basis(q) * jg.basis.orthonormalized()
			sk.set_bone_pose_rotation(j, (pg.basis.orthonormalized().inverse() * new_global).get_rotation_quaternion())
		if sk.get_bone_global_pose(eff).origin.distance_squared_to(target) < 0.25:
			break


func _rot(sk: Skeleton3D, n: String, a: float) -> void:
	var q := sk.get_bone_pose_rotation(b[n])
	sk.set_bone_pose_rotation(b[n], q * Quaternion(Vector3.RIGHT, a))
