execute at @e[type=pntmc:king, tag=spawnonlyone] run event entity @e[type=pntmc:king, tag=!spawnonlyone] pntmc:despawn
execute at @e[type=pntmc:king_trigger, tag=spawnonlyone] run event entity @e[type=pntmc:king_trigger, tag=!spawnonlyone] pntmc:despawn
execute at @e[type=pntmc:king_ambient, tag=spawnonlyone] run event entity @e[type=pntmc:king_ambient, tag=!spawnonlyone] pntmc:despawn
tag @e[type=pntmc:king, c=1] add spawnonlyone
tag @e[type=pntmc:king_trigger, c=1] add spawnonlyone
tag @e[type=pntmc:king_ambient, c=1] add spawnonlyone
# code by @PnTMCvn on Youtube ,DO NOT REUP or REMAKE or STEAL my code