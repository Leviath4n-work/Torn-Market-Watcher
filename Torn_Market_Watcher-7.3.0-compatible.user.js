// ==UserScript==
// @name         TornPDA Universal Market Watcher
// @namespace    leviath4n.torn.marketwatch.v6.7.2
// @version      7.3.0
// @description  Movable, responsive market watcher with direct listing alerts, integrated RW Scout, completed-sales analysis, and HTTP-compatible membership.
// @author       Leviath4n
// @updateURL    https://raw.githubusercontent.com/Leviath4n-work/Torn-Market-Watcher/main/Torn_Market_Watcher.user.js
// @downloadURL  https://raw.githubusercontent.com/Leviath4n-work/Torn-Market-Watcher/main/Torn_Market_Watcher.user.js


// @match        https://www.torn.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_info
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @noframes
// @connect      api.torn.com
// @connect      torn.com
// @connect      146.190.216.11
// ==/UserScript==

(function () {
  'use strict';
  if (window.top !== window.self) return;
  if (document.getElementById('umw-instance-marker')) return;
  const instanceMarker = document.createElement('meta');
  instanceMarker.id = 'umw-instance-marker';
  (document.head || document.documentElement).appendChild(instanceMarker);

  // GitHub update/download metadata is preserved for future releases.
  // HTTP compatibility is explicitly enabled for the configured membership server.
  // Switch backendBaseUrl and @connect to verified HTTPS when available.
  let storageHealthy = true;
  let scanRevision = 0;
  let authRevision = 0;
  let pageSuspended = false;
  let sessionApiKey = '';
  let apiQueue = Promise.resolve();
  const pendingRequests = new Set();
  const fallbackStorage = new Map();
  const localStore = {
    getItem(key) {
      try { return localStorage.getItem(key); }
      catch { storageHealthy = false; return fallbackStorage.get(key) ?? null; }
    },
    setItem(key, value) {
      fallbackStorage.set(key, String(value));
      try { localStorage.setItem(key, String(value)); }
      catch { storageHealthy = false; }
    },
    removeItem(key) {
      fallbackStorage.delete(key);
      try { localStorage.removeItem(key); }
      catch { storageHealthy = false; }
    }
  };
  const privateKeyStorage = typeof GM_getValue === 'function' &&
    typeof GM_setValue === 'function' && typeof GM_deleteValue === 'function' &&
    typeof GM_info !== 'undefined' && /Tampermonkey|Violentmonkey|Greasemonkey/i.test(GM_info.scriptHandler || '');

  function cancelScans() {
    scanRevision++;
    for (const request of [...pendingRequests]) request.cancel();
  }
  function canScan(revision = scanRevision) {
    return revision === scanRevision && !pageSuspended && storageHealthy &&
      isLeader && getLeaderInfo().id === TAB_ID && isEnabled() &&
      isMembershipActive() && !!getEffectiveApiKey();
  }
  function assertScan(revision) {
    if (!canScan(revision)) throw Object.assign(new Error('Scan cancelled'), { cancelled: true });
  }
  function bounded(value, fallback, min, max) {
    const n = value === null || value === '' ? NaN : Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }
  function cleanMessage(value) {
    let message = String(value || '').slice(0, 1000);
    if (sessionApiKey) message = message.split(sessionApiKey).join('[redacted]');
    return message.replace(/([?&]key=)[^&\s]+/gi, '$1[redacted]');
  }


  function getScriptVersion() {
    try {
      return (typeof GM_info !== 'undefined' && GM_info?.script?.version) ? GM_info.script.version : '7.3.0';
    } catch {
      return '7.3.0';
    }
  }

  /*
    6.5.6 changes
    - Debug header version now auto-reads from GM_info.script.version
    - Added GM_info grant for Tampermonkey version access
  */


  // ---------------------------------------------------------------------------
  // Foundation config and runtime state
  // ---------------------------------------------------------------------------

  const SCRIPT_VERSION = getScriptVersion();

  const APP_CONFIG = Object.freeze({
    backendBaseUrl: 'http://146.190.216.11:3000',
    allowInsecureMembership: true, // Compatibility requested by the server owner.
    persistPageApiKey: true, // PDA fallback; readable by scripts on the Torn origin.
    membership: {
      trialMessage: 'Initial API signup comes with 1 day membership to trial use.',
      paymentMessage: 'Send 1 Xanax to Leviathan [3634894] to get 5 days membership.',
      refreshMs: 5 * 60 * 1000,
      keys: {
        playerId: 'umw_playerId_v1',
        playerName: 'umw_playerName_v1',
        apiKey: 'umw_apiKey_v1',
        lastAuthStatus: 'umw_lastAuthStatus_v1'
      }
    },
    ui: {
      debugTapCount: 5,
      debugTapWindowMs: 2500,
      singleTapDelayMs: 320
    },
    defaults: {
      pollMs: 30000,
      alertCooldownMs: 2 * 60 * 1000,
      vibrationEnabled: true,
      soundEnabled: false,
      soundVolume: 100,
      soundPreset: 'classic',
      desktopNotificationsEnabled: false
    },
    timing: {
      valueRefreshMs: 24 * 60 * 60 * 1000,
      seenTtlMs: 15 * 60 * 1000,
      popupHistoryTtlMs: 3 * 60 * 60 * 1000,
      popupHistoryMax: 100,
      lockTimeoutMs: 45000,
      heartbeatMs: 10000
    },
    market: {
      taxRate: 0.05,
      compUndercut: 1,
      // Estimates use the cheapest observed comparable asking price.
    },
    storageKeys: {
    enabled: 'umw_enabled_v56',
    debugVisible: 'umw_debugVisible_v56',
    debugPanelMinimized: 'umw_debugPanelMinimized_v56',
    settings: 'umw_settings_v56',
    watchlist: 'umw_watchlist_v56',
    marketValues: 'umw_marketValues_v56',
    lastValueFetch: 'umw_lastValueFetch_v56',
    seenMap: 'umw_seenMap_v56',
    lastAlert: 'umw_lastAlert_v56',
    lastError: 'umw_lastError_v56',
    lastScanAt: 'umw_lastScanAt_v56',
    velocity: 'umw_velocity_v57',
    debugPanelPos: 'umw_debugPanelPos_v57',
    debugPanelSize: 'umw_debugPanelSize_v653',
    scanStatus: 'umw_scanStatus_v591',
    popupHistory: 'umw_popupHistory_v5100',
    debugSections: 'umw_debugSections_v650',
    presets: 'umw_presets_v671',
    }
  });

  const BACKEND_BASE_URL = APP_CONFIG.backendBaseUrl;
  const MEMBERSHIP_TRIAL_MESSAGE = APP_CONFIG.membership.trialMessage;
  const MEMBERSHIP_PAYMENT_MESSAGE = APP_CONFIG.membership.paymentMessage;
  const MEMBERSHIP_KEYS = APP_CONFIG.membership.keys;

  const DEBUG_TAP_COUNT = APP_CONFIG.ui.debugTapCount;
  const DEBUG_TAP_WINDOW_MS = APP_CONFIG.ui.debugTapWindowMs;
  const SINGLE_TAP_DELAY_MS = APP_CONFIG.ui.singleTapDelayMs;

  const DEFAULTS = APP_CONFIG.defaults;

  const VALUE_REFRESH_MS = APP_CONFIG.timing.valueRefreshMs;
  const SEEN_TTL_MS = APP_CONFIG.timing.seenTtlMs;
  const POPUP_HISTORY_TTL_MS = APP_CONFIG.timing.popupHistoryTtlMs;
  const POPUP_HISTORY_MAX = APP_CONFIG.timing.popupHistoryMax;

  const MARKET_TAX_RATE = APP_CONFIG.market.taxRate;
  const COMP_UNDERCUT = APP_CONFIG.market.compUndercut;

  const TAB_ID = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const LOCK_KEY = 'umw_active_tab';
  const LOCK_HEARTBEAT_KEY = 'umw_active_heartbeat';
  const LOCK_TIMEOUT_MS = APP_CONFIG.timing.lockTimeoutMs;
  const HEARTBEAT_MS = APP_CONFIG.timing.heartbeatMs;
  const MEMBERSHIP_REFRESH_MS = APP_CONFIG.membership.refreshMs;
  let membershipRefreshTimer = null;
  let membershipRefreshInFlight = false;


  const UI_THEME = {
    panelBg: 'rgba(9, 12, 18, 0.97)',
    panelBorder: '1px solid rgba(255,255,255,0.10)',
    panelRadius: '16px',
    sectionBg: 'rgba(255,255,255,0.035)',
    sectionBorder: '1px solid rgba(255,255,255,0.09)',
    sectionRadius: '12px',
    inputBg: '#10151d',
    subtleText: 'rgba(255,255,255,0.72)',
    strongText: '#ffffff',
    mutedBtnBg: '#111822',
    mutedBtnBorder: '1px solid rgba(255,255,255,0.12)',
    primaryBtnBg: 'linear-gradient(180deg, rgba(38,56,86,0.98), rgba(24,34,52,0.98))',
    primaryBtnBorder: '1px solid rgba(120,170,255,0.24)',
    dangerBtnBg: 'linear-gradient(180deg, rgba(84,30,34,0.95), rgba(58,18,22,0.95))',
    dangerBtnBorder: '1px solid rgba(255,120,120,0.22)',
    shadow: '0 10px 30px rgba(0,0,0,0.35)'
  };

  const runtimeCache = {
    settings: null,
    watchlist: null,
    marketValues: null,
    popupHistory: null,
    velocity: null,
    scanStatus: null,
    seenMap: null,
    presets: null
  };

  function invalidateRuntimeCache(key = null) {
    if (!key) {
      runtimeCache.settings = null;
      runtimeCache.watchlist = null;
      runtimeCache.marketValues = null;
      runtimeCache.popupHistory = null;
      runtimeCache.velocity = null;
      runtimeCache.scanStatus = null;
      runtimeCache.seenMap = null;
      runtimeCache.presets = null;
      return;
    }
    if (Object.prototype.hasOwnProperty.call(runtimeCache, key)) {
      runtimeCache[key] = null;
    }
  }


  const STORAGE_KEYS = APP_CONFIG.storageKeys;


  const ITEM_CATALOG_RAW = String.raw`
hammer 1
baseball_bat 2
crow_bar 3
knuckle_dusters 4
pen_knife 5
kitchen_knife 6
dagger 7
axe 8
scimitar 9
chainsaw 10
samurai_sword 11
glock_17 12
raven_mp25 13
ruger_22/45 14
beretta_m9 15
usp 16
beretta_92fs 17
fiveseven 18
magnum 19
desert_eagle 20
dual_92g_berettas 21
sawed-off_shotgun 22
benelli_m1_tactical 23
mp5_navy 24
p90 25
ak-47 26
m4a1_colt_carbine 27
benelli_m4_super 28
m16_a2_rifle 29
steyr_aug 30
m249_para_lmg 31
leather_vest 32
police_vest 33
bulletproof_vest 34
box_of_chocolate_bars 35
big_box_of_chocolate_bars 36
bag_of_bon_bons 37
box_of_bon_bons 38
box_of_extra_strong_mints 39
pack_of_music_cds 40
dvd_player 41
mp3_player 42
cd_player 43
pack_of_blank_cds 44
hard_drive 45
tank_top 46
pair_of_trainers 47
jacket 48
full_body_armor 49
outer_tactical_vest 50
plain_silver_ring 51
sapphire_ring 52
gold_ring 53
diamond_ring 54
pearl_necklace 55
silver_necklace 56
gold_necklace 57
plastic_watch 58
stainless_steel_watch 59
gold_watch 60
personal_computer 61
microwave 62
minigun 63
pack_of_cuban_cigars 64
big_tv_screen 65
morphine 66
first_aid_kit 67
small_first_aid_kit 68
simple_virus 69
polymorphic_virus 70
tunnelling_virus 71
armored_virus 72
stealth_virus 73
santa_hat_'04 74
christmas_cracker_'04 75
snow_cannon 76
toyota_mr2 77
honda_nsx 78
audi_tt_quattro 79
bmw_m5 80
bmw_z8 81
chevrolet_corvette_z06 82
dodge_charger 83
pontiac_firebird 84
ford_gt40 85
hummer_h3 86
audi_s4 87
honda_integra_r 88
honda_accord 89
honda_civic 90
volkswagen_beetle 91
chevrolet_cavalier 92
ford_mustang 93
reliant_robin 94
holden_ss 95
coat_hanger 96
bunch_of_flowers 97
neutrilux_2000 98
springfield_1911-a1 99
egg_propelled_launcher 100
bunny_suit 101
chocolate_egg_'05 102
firewalk_virus 103
playstation 104
xbox 105
parachute 106
trench_coat 107
9mm_uzi 108
rpg_launcher 109
leather_bull_whip 110
ninja_claws 111
test_trophy 112
pet_rock 113
non-anon_doll 114
poker_doll 115
yoda_figurine 116
trojan_horse 117
evil_doll 118
rubber_ducky_of_doom 119
teppic_bear 120
rockerhead_doll 121
mouser_doll 122
elite_action_man 123
toy_reactor 124
royal_doll 125
blue_dragon 126
china_tea_set 127
mufasa_toy 128
dozen_roses 129
skanky_doll 130
lego_hurin 131
mystical_sphere 132
10_ton_pacifier 133
horse 134
uriel's_speakers 135
strife_clown 136
locked_teddy 137
riddle's_bat 138
soup_nazi_doll 139
pouncer_doll 140
spammer_doll 141
cookie_jar 142
vanity_mirror 143
banana_phone 144
xbox_360 145
yasukuni_sword 146
rusty_sword 147
dance_toy 148
lucky_dime 149
crystal_carousel 150
pixie_sticks 151
ice_sculpture 152
case_of_whiskey 153
laptop 154
purple_frog_doll 155
skeleton_key 156
patriot_whip 157
statue_of_aeolus 158
bolt_cutters 159
photographs 160
black_unicorn 161
warpaint_kit 162
official_ninja_kit 163
leukaemia_teddybear 164
chocobo_flute 165
annoying_man 166
article_on_crime 167
unknown 168
barbie_doll 169
wand_of_destruction 170
jack-o-lantern_'05 171
gas_can 172
butterfly_knife 173
xm8_rifle 174
taser 175
chain_mail 176
cobra_derringer 177
flak_jacket 178
birthday_cake_'05 179
bottle_of_beer 180
bottle_of_champagne 181
soap_on_a_rope 182
single_red_rose 183
bunch_of_black_roses 184
bunch_of_balloons_'05 185
sheep_plushie 186
teddy_bear_plushie 187
cracked_crystal_ball 188
s&w_revolver 189
c4_explosive 190
memory_locket 191
rainbow_stud_earring 192
hamster_toy 193
snowflake_'05 194
christmas_tree_'05 195
cannabis 196
ecstasy 197
ketamine 198
lsd 199
opium 200
pcp 201
mr_torn_crown_'07 202
shrooms 203
speed 204
vicodin 205
xanax 206
ms_torn_crown_'07 207
unknown 208
box_of_sweet_hearts 209
bag_of_chocolate_kisses 210
crazy_cow 211
legend's_urn 212
dreamcatcher 213
brutus_keychain 214
kitten_plushie 215
single_white_rose 216
claymore_sword 217
crossbow 218
enfield_sa-80 219
grenade 220
stick_grenade 221
flash_grenade 222
jackhammer 223
swiss_army_knife 224
mag_7 225
smoke_grenade 226
spear 227
vektor_cr-21 228
claymore_mine 229
flare_gun 230
heckler_&_koch_sl8 231
sig_550 232
bt_mp9 233
chain_whip 234
wooden_nunchakus 235
kama 236
kodachi_swords 237
sai 238
ninja_stars 239
anti_tank 240
bushmaster_carbon_15_type_21s 241
heg 242
taurus 243
blowgun 244
bo_staff 245
fireworks 246
katana 247
qsz-92 248
sks_carbine 249
twin_tiger_hooks 250
wushu_double_axes 251
ithaca_37 252
lorcin_380 253
s&w_m29 254
flamethrower 255
tear_gas 256
throwing_knife 257
jaguar_plushie 258
mayan_statue 259
dahlia 260
wolverine_plushie 261
hockey_stick 262
crocus 263
orchid 264
pele_charm 265
nessie_plushie 266
heather 267
red_fox_plushie 268
monkey_plushie 269
soccer_ball 270
ceibo_flower 271
edelweiss 272
chamois_plushie 273
panda_plushie 274
jade_buddha 275
peony 276
cherry_blossom 277
kabuki_mask 278
maneki_neko 279
elephant_statue 280
lion_plushie 281
african_violet 282
donator_pack 283
bronze_paint_brush 284
silver_paint_brush 285
gold_paint_brush 286
pand0ra's_box 287
mr_brownstone_doll 288
dual_axes 289
dual_hammers 290
dual_scimitars 291
dual_samurai_swords 292
japanese/english_dictionary 293
bottle_of_sake 294
oriental_log 295
oriental_log_translation 296
youyou_yo_yo 297
monkey_cuffs 298
jester's_cap 299
gibal's_dragonfly 300
green_ornament 301
purple_ornament 302
blue_ornament 303
purple_bell 304
mistletoe 305
mini_sleigh 306
snowman 307
christmas_gnome 308
gingerbread_house 309
lollipop 310
mardi_gras_beads 311
devil_toy 312
cookie_launcher 313
cursed_moon_pendant 314
apartment_blueprint 315
semi-detached_house_blueprint 316
detached_house_blueprint 317
beach_house_blueprint 318
chalet_blueprint 319
villa_blueprint 320
penthouse_blueprint 321
mansion_blueprint 322
ranch_blueprint 323
palace_blueprint 324
castle_blueprint 325
printing_paper 326
blank_tokens 327
blank_credit_cards 328
skateboard 329
boxing_gloves 330
dumbbells 331
combat_vest 332
liquid_body_armor 333
flexible_body_armor 334
stick_of_dynamite 335
cesium-137 336
dirty_bomb 337
sh0rty's_surfboard 338
puzzle_piece 339
hunny_pot 340
seductive_stethoscope 341
dollar_bill_collectible 342
backstage_pass 343
chemi's_magic_potion 344
pack_of_trojans 345
pair_of_high_heels 346
thong 347
hazmat_suit 348
flea_collar 349
dunkin's_donut 350
amazon_doll 351
bbq_smoker 352
bag_of_cheetos 353
motorbike 354
citrus_squeezer 355
superman_shades 356
kevlar_helmet 357
raw_ivory 358
fine_chisel 359
ivory_walking_cane 360
neumune_tablet 361
mr_torn_crown_'08 362
ms_torn_crown_'08 363
box_of_grenades 364
box_of_medical_supplies 365
erotic_dvd 366
feathery_hotel_coupon 367
lawyer_business_card 368
lottery_voucher 369
drug_pack 370
dark_doll 371
empty_box 372
parcel 373
birthday_present 374
present 375
christmas_present 376
birthday_wrapping_paper 377
generic_wrapping_paper 378
christmas_wrapping_paper 379
small_explosive_device 380
gold_laptop 381
gold_plated_ak-47 382
platinum_pda 383
camel_plushie 384
tribulus_omanense 385
sports_sneakers 386
handbag 387
pink_mac-10 388
mr_torn_crown_'09 389
ms_torn_crown_'09 390
macana 391
pepper_spray 392
slingshot 393
brick 394
metal_nunchakus 395
business_class_ticket 396
mace 397
swiss_army_sg_550 398
armalite_m-15a4_rifle 399
guandao 400
lead_pipe 401
ice_pick 402
box_of_tissues 403
bandana 404
loaf_of_bread 405
afro_comb 406
compass 407
sextant 408
yucca_plant 409
fire_hydrant 410
model_space_ship 411
sports_shades 412
mountie_hat 413
proda_sunglasses 414
ship_in_a_bottle 415
paper_weight 416
rs232_cable 417
tailors_dummy 418
small_suitcase 419
medium_suitcase 420
large_suitcase 421
vanity_hand_mirror 422
poker_chip 423
rabbit_foot 424
voodoo_doll 425
bottle_of_tequila 426
sumo_doll 427
casino_pass 428
chopsticks 429
coconut_bra 430
dart_board 431
crazy_straw 432
sensu 433
yakitori_lantern 434
dozen_white_roses 435
snowboard 436
glow_stick 437
cricket_bat 438
frying_pan 439
pillow 440
khinkeh_p0rnstar_doll 441
blow-up_doll 442
strawberry_milkshake 443
breadfan_doll 444
chaos_man 445
karate_man 446
burmese_flag 447
bl0ndie's_dictionary 448
hydroponic_grow_tent 449
leopard_coin 450
florin_coin 451
gold_noble_coin 452
ganesha_sculpture 453
vairocana_buddha_sculpture 454
script_from_the_quran:_ibn_masud 455
script_from_the_quran:_ubay_ibn_kab 456
script_from_the_quran:_ali 457
shabti_sculpture 458
egyptian_amulet 459
white_senet_pawn 460
black_senet_pawn 461
senet_board 462
epinephrine 463
melatonin 464
serotonin 465
snow_globe_'09 466
dancing_santa_claus_'09 467
christmas_stocking_'09 468
santa's_elf_'09 469
christmas_card_'09 470
admin_portrait_'09 471
blue_easter_egg 472
green_easter_egg 473
red_easter_egg 474
yellow_easter_egg 475
white_easter_egg 476
black_easter_egg 477
gold_easter_egg 478
metal_dog_tag 479
bronze_dog_tag 480
silver_dog_tag 481
gold_dog_tag 482
mp5k 483
ak74u 484
skorpion 485
tmp 486
thompson 487
mp_40 488
luger 489
blunderbuss 490
zombie_brain 491
human_head 492
medal_of_honor 493
citroen_saxo 494
classic_mini 495
fiat_punto 496
nissan_micra 497
peugeot_106 498
renault_clio 499
vauxhall_corsa 500
volvo_850 501
alfa_romeo_156 502
bmw_x5 503
seat_leon_cupra 504
vauxhall_astra_gsi 505
volkswagen_golf_gti 506
audi_s3 507
ford_focus_rs 508
honda_s2000 509
mini_cooper_s 510
sierra_cosworth 511
lotus_exige 512
mitsubishi_evo_x 513
porsche_911_gt3 514
subaru_impreza_sti 515
tvr_sagaris 516
aston_martin_one-77 517
audi_r8 518
bugatti_veyron 519
ferrari_458 520
lamborghini_gallardo 521
lexus_lfa 522
mercedes_slr 523
nissan_gt-r 524
mr_torn_crown_'10 525
ms_torn_crown_'10 526
bag_of_candy_kisses 527
bag_of_tootsie_rolls 528
bag_of_chocolate_truffles 529
can_of_munster 530
bottle_of_pumpkin_brew 531
can_of_red_cow 532
can_of_tourine_elite 533
witch's_cauldron 534
electronic_pumpkin 535
jack_o_lantern_lamp 536
spooky_paper_weight 537
medieval_helmet 538
blood_spattered_sickle 539
cauldron 540
bottle_of_stinky_swamp_punch 541
bottle_of_wicked_witch 542
deputy_star 543
wind_proof_lighter 544
dual_tmps 545
dual_bushmasters 546
dual_mp5s 547
dual_p90s 548
dual_uzis 549
bottle_of_kandy_kane 550
bottle_of_minty_mayhem 551
bottle_of_mistletoe_madness 552
can_of_santa_shooters 553
can_of_rockstar_rudolph 554
can_of_x-mass 555
bag_of_reindeer_droppings 556
advent_calendar 557
santa's_snot 558
polar_bear_toy 559
fruitcake 560
book_of_carols 561
sweater 562
gift_card 563
pair_of_glasses 564
high-speed_dvd_drive 565
mountain_bike 566
cut-throat_razor 567
slim_crowbar 568
balaclava 569
advanced_driving_tactics_manual 570
ergonomic_keyboard 571
tracking_device 572
screwdriver 573
fanny_pack 574
tumble_dryer 575
chloroform 576
heavy_duty_padlock 577
duct_tape 578
wireless_dongle 579
horse's_head 580
book 581
tin_foil_hat 582
brown_easter_egg 583
orange_easter_egg 584
pink_easter_egg 585
jawbreaker 586
bag_of_sherbet 587
goodie_bag 588
undefined 589
undefined_2 590
undefined_3 591
undefined_4 592
mr_torn_crown_'11 593
ms_torn_crown_'11 594
pile_of_vomit 595
rusty_dog_tag 596
gold_nugget 597
witch's_hat 598
golden_broomstick 599
devil's_pitchfork 600
christmas_lights 601
gingerbread_man 602
golden_wreath 603
pair_of_ice_skates 604
diamond_icicle 605
santa_boots 606
santa_gloves 607
santa_hat 608
santa_jacket 609
santa_trousers 610
snowball 611
tavor_tar-21 612
harpoon 613
diamond_bladed_knife 614
naval_cutlass_sword 615
trout 616
banana_orchid 617
stingray_plushie 618
steel_drum 619
nodding_turtle 620
snorkel 621
flippers 622
speedo 623
bikini 624
wetsuit 625
diving_gloves 626
dog_poop 627
stink_bombs 628
toilet_paper 629
mr_torn_crown_'12 630
ms_torn_crown_'12 631
petrified_humerus 632
latex_gloves 633
bag_of_bloody_eyeballs 634
straitjacket 635
cinnamon_ornament 636
christmas_express 637
bottle_of_christmas_cocktail 638
golden_candy_cane 639
kevlar_gloves 640
wwii_helmet 641
motorcycle_helmet 642
construction_helmet 643
welding_helmet 644
safety_boots 645
hiking_boots 646
leather_helmet 647
leather_pants 648
leather_boots 649
leather_gloves 650
combat_helmet 651
combat_pants 652
combat_boots 653
combat_gloves 654
riot_helmet 655
riot_body 656
riot_pants 657
riot_boots 658
riot_gloves 659
dune_helmet 660
dune_body 661
dune_pants 662
dune_boots 663
dune_gloves 664
assault_helmet 665
assault_body 666
assault_pants 667
assault_boots 668
assault_gloves 669
delta_gas_mask 670
delta_body 671
delta_pants 672
delta_boots 673
delta_gloves 674
marauder_face_mask 675
marauder_body 676
marauder_pants 677
marauder_boots 678
marauder_gloves 679
eod_helmet 680
eod_apron 681
eod_pants 682
eod_boots 683
eod_gloves 684
torn_bible 685
friendly_bot_guide 686
egotistical_bear 687
brewery_key 688
signed_jersey 689
mafia_kit 690
octopus_toy 691
bear_skin_rug 692
tractor_toy 693
mr_torn_crown_'13 694
ms_torn_crown_'13 695
piece_of_cake 696
rotten_eggs 697
peg_leg 698
antidote 699
christmas_angel 700
eggnog 701
sprig_of_holly 702
festive_socks 703
respo_hoodie 704
staff_haxx_button 705
birthday_cake_'14 706
lump_of_coal 707
gold_ribbon 708
silver_ribbon 709
bronze_ribbon 710
coin_:_factions 711
coin_:_casino 712
coin_:_education 713
coin_:_hospital 714
coin_:_jail 715
coin_:_travel_agency 716
coin_:_companies 717
coin_:_stock_exchange 718
coin_:_church 719
coin_:_auction_house 720
coin_:_race_track 721
coin_:_museum 722
coin_:_drugs 723
coin_:_dump 724
coin_:_estate_agents 725
scrooge's_top_hat 726
scrooge's_topcoat 727
scrooge's_trousers 728
scrooge's_boots 729
scrooge's_gloves 730
empty_blood_bag 731
blood_bag_:_a+ 732
blood_bag_:_a- 733
blood_bag_:_b+ 734
blood_bag_:_b- 735
blood_bag_:_ab+ 736
blood_bag_:_ab- 737
blood_bag_:_o+ 738
blood_bag_:_o- 739
mr_torn_crown 740
ms_torn_crown 741
molotov_cocktail 742
christmas_sweater_'15 743
book_:_brawn_over_brains 744
book_:_time_is_in_the_mind 745
book_:_keeping_your_face_handsome 746
book_:_a_job_for_your_hands 747
book_:_working_9_til_5 748
book_:_making_friends,_enemies,_and_cakes 749
book_:_high_school_for_adults 750
book_:_milk_yourself_sober 751
book_:_fight_like_an_******* 752
book_:_mind_over_matter 753
book_:_no_shame_no_pain 754
book_:_run_like_the_wind 755
book_:_weaseling_out_of_trouble 756
book_:_get_hard_or_go_home 757
book_:_gym_grunting_-_shouting_to_success 758
book_:_self_defense_in_the_workplace 759
book_:_speed_3_-_the_rejected_script 760
book_:_limbo_lovers_101 761
book_:_the_hamburglar's_guide_to_crime 762
book_:_what_are_old_folk_good_for_anyway? 763
book_:_medical_degree_schmedical_degree 764
book_:_no_more_soap_on_a_rope 765
book_:_mailing_yourself_abroad 766
book_:_smuggling_for_beginners 767
book_:_stealthy_stealing_of_underwear 768
book_:_shawshank_sure_ain't_for_me! 769
book_:_ignorance_is_bliss 770
book_:_winking_to_win 771
book_:_finders_keepers 772
book_:_hot_turkey 773
book_:_higher_daddy,_higher! 774
book_:_the_real_dutch_courage 775
book_:_because_i'm_happy_-_the_pharrell_story 776
book_:_no_more_sick_days 777
book_:_duke_-_my_story 778
book_:_self_control_is_for_losers 779
book_:_going_back_for_more 780
book_:_get_drunk_and_lose_dignity 781
book_:_fuelling_your_way_to_failure 782
book_:_yes_please_diabetes 783
book_:_ugly_energy 784
book_:_memories_and_mammaries 785
book_:_brown-nosing_the_boss 786
book_:_running_away_from_trouble 787
certificate_of_awesome 788
certificate_of_lame 789
plastic_sword 790
mediocre_t-shirt 791
penelope 792
cake_frosting 793
lock_picking_kit 794
special_fruitcake 795
felovax 796
zylkene 797
duke's_safe 798
duke's_selfies 799
duke's_poetry 800
duke's_dog's_ashes 801
duke's_will 802
duke's_gimp_mask 803
duke's_herpes_medication 804
duke's_hammer 805
old_lady_mask 806
exotic_gentleman_mask 807
ginger_kid_mask 808
young_lady_mask 809
moustache_man_mask 810
scarred_man_mask 811
psycho_clown_mask 812
nun_mask 813
tyrosine 814
keg_of_beer 815
glass_of_beer 816
six_pack_of_alcohol 817
six_pack_of_energy_drink 818
rosary_beads 819
piggy_bank 820
empty_vial 821
vial_of_blood 822
vial_of_urine 823
vial_of_saliva 824
questionnaire_ 825
agreement 826
perceptron_:_calibrator 827
donald_trump_mask_'16 828
yellow_snowman_'16 829
nock_gun 830
beretta_pico 831
riding_crop 832
sand 833
sweatpants 834
string_vest 835
black_oxfords 836
rheinmetall_mg_3 837
homemade_pocket_shotgun 838
madball 839
nail_bomb 840
classic_fedora 841
pinstripe_suit_trousers 842
duster 843
tranquilizer_gun_ 844
bolt_gun 845
scalpel 846
nerve_gas 847
kevlar_lab_coat 848
loupes 849
sledgehammer 850
wifebeater 851
metal_detector 852
graveyard_key 853
questionnaire_:_completed 854
agreement_:_signed 855
spray_can_:_black 856
spray_can_:_red 857
spray_can_:_pink 858
spray_can_:_purple 859
spray_can_:_blue 860
spray_can_:_green 861
spray_can_:_yellow 862
spray_can_:_orange 863
salt_shaker 864
poison_mistletoe 865
santa's_list_'17 866
soapbox 867
turkey_baster 868
elon_musk_mask_'17 869
love_juice 870
bug_swatter 871
nothing 872
bottle_of_green_stout 873
prototype 874
rotten_apple 875
festering_chicken 876
mouldy_pizza 877
smelly_cheese 878
sour_milk 879
stale_bread 880
spoiled_fish 881
insurance_policy_ 882
bank_statement 883
car_battery 884
scrap_metal 885
torn_city_times 886
karma!_magazine 887
umbrella 888
travel_mug 889
headphones 890
travel_socks 891
mix_cd 892
lost_and_found_office_key 893
cosmetics_case 894
phone_card 895
subway_season_ticket 896
bottle_cap 897
silver_coin 898
silver_bead 899
lucky_quarter 900
daffodil 901
bunch_of_carnations 902
white_lily 903
funeral_wreath 904
car_keys 905
handkerchief 906
candle 907
paper_bag 908
tin_can 909
betting_slip 910
fidget_spinner 911
majestic_moose 912
lego_wonder_woman 913
cr7_doll 914
stretch_armstrong_doll 915
beef_femur 916
snake's_fang 917
icey_igloo 918
federal_jail_key 919
`;

  const uiState = {
    searchQuery: '',
    searchFocused: false
  };

  let isLeader = false;
  let isRunningLoop = false;

  let badgeEl = null;
  let toastWrap = null;
  let debugPanelEl = null;
  let audioCtx = null;

  let tapTimes = [];
  let singleTapTimer = null;

  let membershipState = {
    checked: false,
    active: false,
    playerId: '',
    playerName: '',
    expiresAt: 0,
    msLeft: 0,
    reason: ''
  };

  const runtimeState = {
    uiState,
    get membershipState() { return membershipState; },
    get isMembershipActive() {
      return !!membershipState.active;
    }
  };

  const debugRenderState = {
    scheduled: false,
    pendingForce: false
  };


function getJson(key, fallback) {
    try {
      const raw = localStore.getItem(key);
      if (raw === null) return fallback;
      const value = JSON.parse(raw);
      if (Array.isArray(fallback)) return Array.isArray(value) ? value : fallback;
      if (fallback && typeof fallback === 'object') {
        return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
      }
      return value ?? fallback;
    } catch { return fallback; }
  }

  function setJson(key, value) {
    localStore.setItem(key, JSON.stringify(value));
  }

  function getNumber(key, fallback = 0) {
    const raw = localStore.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  function setNumber(key, value) {
    localStore.setItem(key, String(value));
  }

  const storage = {
    getJson,
    setJson,
    getNumber,
    setNumber,
    getString(key, fallback = '') {
      const raw = localStore.getItem(key);
      return raw === null ? fallback : String(raw);
    },
    setString(key, value) {
      localStore.setItem(key, String(value ?? ''));
    },
    remove(key) {
      localStore.removeItem(key);
    },
    membership: {
      getPlayerId() {
        return storage.getString(MEMBERSHIP_KEYS.playerId, '');
      },
      setPlayerId(playerId) {
        storage.setString(MEMBERSHIP_KEYS.playerId, playerId || '');
      },
      getPlayerName() {
        return storage.getString(MEMBERSHIP_KEYS.playerName, '');
      },
      setPlayerName(playerName) {
        storage.setString(MEMBERSHIP_KEYS.playerName, playerName || '');
      },
      getApiKey() {
        return getStoredApiKey();
      },
      setApiKey(apiKey) {
        setStoredApiKey(apiKey);
      },
      getLastAuthStatus() {
        return storage.getJson(MEMBERSHIP_KEYS.lastAuthStatus, null);
      },
      setLastAuthStatus(status) {
        storage.setJson(MEMBERSHIP_KEYS.lastAuthStatus, status || null);
      },
      clear() {
        storage.remove(MEMBERSHIP_KEYS.playerId);
        storage.remove(MEMBERSHIP_KEYS.playerName);
        storage.remove(MEMBERSHIP_KEYS.apiKey);
        storage.remove(MEMBERSHIP_KEYS.lastAuthStatus);
      }
    },
    settings: {
      get() {
        const stored = storage.getJson(STORAGE_KEYS.settings, {});
        return {
          pollMs: Number.isFinite(Number(stored.pollMs)) ? Number(stored.pollMs) : DEFAULTS.pollMs,
          alertCooldownMs: Number.isFinite(Number(stored.alertCooldownMs)) ? Number(stored.alertCooldownMs) : DEFAULTS.alertCooldownMs,
          vibrationEnabled: typeof stored.vibrationEnabled === 'boolean' ? stored.vibrationEnabled : DEFAULTS.vibrationEnabled,
          soundEnabled: typeof stored.soundEnabled === 'boolean' ? stored.soundEnabled : DEFAULTS.soundEnabled,
          soundVolume: Number.isFinite(Number(stored.soundVolume)) ? Number(stored.soundVolume) : DEFAULTS.soundVolume,
          digestEnabled: stored.digestEnabled !== false,
          priceHistoryEnabled: stored.priceHistoryEnabled !== false,
          soundPreset: typeof stored.soundPreset === 'string' ? stored.soundPreset : DEFAULTS.soundPreset,
          desktopNotificationsEnabled: typeof stored.desktopNotificationsEnabled === 'boolean'
            ? stored.desktopNotificationsEnabled
            : DEFAULTS.desktopNotificationsEnabled
        };
      },
      save(settings) {
        storage.setJson(STORAGE_KEYS.settings, settings);
      }
    },
    watchlist: {
      get() {
        return storage.getJson(STORAGE_KEYS.watchlist, []);
      },
      save(list) {
        storage.setJson(STORAGE_KEYS.watchlist, list);
      }
    },
    presets: {
      get() {
        return storage.getJson(STORAGE_KEYS.presets, {});
      },
      save(bundle) {
        storage.setJson(STORAGE_KEYS.presets, bundle);
      }
    },
    popupHistory: {
      get() {
        return storage.getJson(STORAGE_KEYS.popupHistory, []);
      },
      save(entries) {
        storage.setJson(STORAGE_KEYS.popupHistory, entries);
      }
    },
    velocity: {
      get() {
        return storage.getJson(STORAGE_KEYS.velocity, {});
      },
      save(map) {
        storage.setJson(STORAGE_KEYS.velocity, map);
      }
    },
    scanStatus: {
      get() {
        return storage.getJson(STORAGE_KEYS.scanStatus, {});
      },
      save(map) {
        storage.setJson(STORAGE_KEYS.scanStatus, map);
      }
    }
  };


  function getStoredPlayerId() {
    return storage.membership.getPlayerId();
  }

  function setStoredPlayerId(playerId) {
    storage.membership.setPlayerId(playerId);
  }

  function getStoredPlayerName() {
    return storage.membership.getPlayerName();
  }

  function setStoredPlayerName(playerName) {
    storage.membership.setPlayerName(playerName);
  }

function getStoredApiKey() { return sessionApiKey; }

function setStoredApiKey(apiKey) {
    sessionApiKey = String(apiKey || '').trim();
    if (privateKeyStorage) {
      try {
        if (sessionApiKey) GM_setValue('umw_private_api_v1', sessionApiKey);
        else GM_deleteValue('umw_private_api_v1');
      } catch { setLastError('API key is available for this page only: private storage failed.'); }
    }
    // Compatibility fallback maintains PDA navigation/reload behavior.
    // This is page storage, not private userscript-manager storage.
    if (!privateKeyStorage && APP_CONFIG.persistPageApiKey && sessionApiKey) {
      localStore.setItem(MEMBERSHIP_KEYS.apiKey, sessionApiKey);
    } else {
      localStore.removeItem(MEMBERSHIP_KEYS.apiKey);
    }
  }

  function initializeCredentials() {
    const legacy = localStore.getItem(MEMBERSHIP_KEYS.apiKey) || '';
    let saved = '';
    if (privateKeyStorage) {
      try { saved = GM_getValue('umw_private_api_v1', '') || ''; } catch {}
    }
    setStoredApiKey(saved || legacy);
  }

  function getEffectiveApiKey() {
    return String(getStoredApiKey() || '').trim();
  }

  function getLastAuthStatus() {
    return storage.membership.getLastAuthStatus();
  }

  function setLastAuthStatus(status) {
    storage.membership.setLastAuthStatus(status);
  }

  
  function clearStoredMembership() {
    invalidateRuntimeCache();
    authRevision++;
    cancelScans();
    setStoredApiKey('');
    storage.membership.clear();

    membershipState = {
      checked: true,
      active: false,
      playerId: '',
      playerName: '',
      expiresAt: 0,
      msLeft: 0,
      reason: 'Not registered'
    };

    requestDebugPanelRefresh(true);
    updateBadge();
  }

function isMembershipActive() {
    return membershipState.active === true && Number.isFinite(membershipState.expiresAt) &&
      membershipState.expiresAt > now();
  }

  function applyMembershipState(status) {
    invalidateRuntimeCache('settings');
    membershipState = {
      checked: true,
      active: status?.active === true,
      playerId: String(status?.playerId || getStoredPlayerId() || ''),
      playerName: String(status?.playerName || getStoredPlayerName() || ''),
      expiresAt: normalizeExpiry(status),
      msLeft: Number(status?.msLeft || 0),
      reason: String(status?.reason || '')
    };

    membershipState.msLeft = Math.max(0, membershipState.expiresAt - now());
    membershipState.active = isMembershipActive();
    setLastAuthStatus(membershipState);
    requestDebugPanelRefresh(true);
    updateBadge();
  }

  function formatMembershipRemaining(ms) {
    const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

function gmRequestJson(method, url, body = null, scanRequest = false) {
    return new Promise((resolve, reject) => {
      let target;
      try { target = new URL(url); } catch { reject(new Error('Invalid service URL')); return; }
      const configuredBackend = new URL(BACKEND_BASE_URL);
      const allowedLegacyMembership = APP_CONFIG.allowInsecureMembership === true &&
        target.protocol === 'http:' && target.origin === configuredBackend.origin &&
        ['/register', '/auth-status'].includes(target.pathname) &&
        ((method === 'POST' && target.pathname === '/register') ||
         (method === 'GET' && target.pathname === '/auth-status'));
      if (target.protocol !== 'https:' && !allowedLegacyMembership) {
        reject(new Error('Membership server requires HTTPS. Ask its operator for a secure endpoint.'));
        return;
      }
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('GM_xmlhttpRequest is unavailable in this userscript environment')); return;
      }
      let settled = false;
      let handle;
      const finish = (error, data) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        pendingRequests.delete(request);
        error ? reject(error) : resolve(data);
      };
      const request = { cancel() {
        finish(Object.assign(new Error('Scan cancelled'), { cancelled: true }));
        try { handle?.abort?.(); } catch {}
      }};
      const watchdog = setTimeout(() => {
        finish(Object.assign(new Error('Request timed out'), { retryable: true }));
        try { handle?.abort?.(); } catch {}
      }, 20000);
      if (scanRequest) pendingRequests.add(request);
      try {
        handle = GM_xmlhttpRequest({
          method, url, timeout: 20000,
          headers: body === null ? {} : { 'Content-Type': 'application/json' },
          ...(body === null ? {} : { data: JSON.stringify(body) }),
          onload(res) {
            try {
              if (res.finalUrl && new URL(res.finalUrl).origin !== target.origin) throw new Error('Unexpected service redirect');
              if (res.status < 200 || res.status >= 300) {
                throw Object.assign(new Error(`HTTP ${res.status}`), {
                  status: res.status, retryable: res.status === 429 || res.status >= 500
                });
              }
              const data = JSON.parse(res.responseText);
              if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid JSON response');
              if (data.error || data.ok === false) {
                throw Object.assign(new Error(cleanMessage(data.error?.error || data.error || 'Request failed')), {
                  code: Number(data.error?.code || 0),
                  retryable: [5, 8, 9, 15, 17].includes(Number(data.error?.code))
                });
              }
              finish(null, data);
            } catch (error) { finish(error); }
          },
          onerror: () => finish(Object.assign(new Error('Network request failed'), { retryable: true })),
          ontimeout: () => finish(Object.assign(new Error('Request timed out'), { retryable: true })),
          onabort: () => finish(Object.assign(new Error('Request aborted'), { cancelled: true }))
        });
      } catch (error) { finish(new Error(cleanMessage(error.message))); }
    });
  }

  function normalizeExpiry(status) {
    const raw = status?.expiresAt;
    let expiry = typeof raw === 'string' && !/^\d+(\.\d+)?$/.test(raw) ? Date.parse(raw) : Number(raw);
    if (Number.isFinite(expiry) && expiry > 0) return expiry < 1e12 ? expiry * 1000 : expiry;
    const remaining = Number(status?.msLeft);
    return Number.isFinite(remaining) && remaining > 0 ? now() + remaining : 0;
  }

  async function backendPost(path, body) {
    return gmRequestJson('POST', `${BACKEND_BASE_URL}${path}`, body);
  }

  async function backendGet(path) {
    return gmRequestJson('GET', `${BACKEND_BASE_URL}${path}`);
  }

async function detectApiKeyType(apiKey) {
    const key = String(apiKey || '').trim();
    if (!/^[a-zA-Z0-9]{16}$/.test(key)) throw new Error('Enter a valid 16-character Torn API key.');
    const data = await apiFetch(`https://api.torn.com/v2/key/info?key=${encodeURIComponent(key)}`, null);
    const access = data.info?.access;
    if (!access) throw new Error('Key permissions could not be verified.');
    return String(access.type || access.level || access).toLowerCase();
  }

  async function registerWithServer(apiKey) {
    const normalizedApiKey = String(apiKey || '').trim();
    const revision = ++authRevision;
    cancelScans();
    const data = await backendPost('/register', { apiKey: normalizedApiKey });
    if (revision !== authRevision) throw new Error('Registration cancelled');
    if (!Number.isSafeInteger(Number(data.playerId)) || Number(data.playerId) <= 0) throw new Error('Invalid registration response');

    setStoredPlayerId(data.playerId);
    setStoredPlayerName(data.playerName);
    setStoredApiKey(normalizedApiKey);

    return data;
  }

async function checkAuthStatus(playerId) {
    const revision = authRevision;
    const data = await backendGet(`/auth-status?playerId=${encodeURIComponent(playerId)}`);
    if (revision !== authRevision || String(playerId) !== getStoredPlayerId()) throw new Error('Membership request cancelled');
    return data;
  }

  async function ensureMembershipReady() {
    const storedPlayerId = getStoredPlayerId();

    if (!storedPlayerId) {
      applyMembershipState({
        active: false,
        reason: 'Not registered'
      });
      return;
    }

    try {
      const status = await checkAuthStatus(storedPlayerId);
      applyMembershipState(status);
    } catch (err) {
      if (getStoredPlayerId() !== storedPlayerId) return;
      applyMembershipState({
        active: false,
        playerId: storedPlayerId,
        playerName: getStoredPlayerName(),
        reason: err?.message || 'Membership check failed'
      });
    }
  }
  
function startMembershipRefreshLoop() {
  if (membershipRefreshTimer) return;

  membershipRefreshTimer = setInterval(async () => {
    if (membershipRefreshInFlight) return;

    const playerId = getStoredPlayerId();
    if (!playerId) return;

    membershipRefreshInFlight = true;

    try {
      const status = await checkAuthStatus(playerId);
      applyMembershipState(status);
      console.log('[UMW] Membership refreshed');
    } catch (err) {
      applyMembershipState({ active: false, reason: cleanMessage(err.message) });
    } finally {
      membershipRefreshInFlight = false;
    }
  }, MEMBERSHIP_REFRESH_MS);
}
  function now() {
    return Date.now();
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function fmtTime(ts) {
    if (!ts) return 'never';
    try {
      return new Date(ts).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return 'unknown';
    }
  }

  function buildMarketUrl(itemId) {
    return `https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=${itemId}`;
  }

  function setLastError(message) {
    const payload = {
      message: cleanMessage(message),
      at: now()
    };
    localStore.setItem(STORAGE_KEYS.lastError, JSON.stringify(payload));
    requestDebugPanelRefresh();
}

  function setLastAlert(message) {
    const payload = {
      message: cleanMessage(message),
      at: now()
    };
    localStore.setItem(STORAGE_KEYS.lastAlert, JSON.stringify(payload));
    requestDebugPanelRefresh();
}

function formatDateTime(ts) {
  if (!ts) return 'never';
  try {
    return new Date(ts).toLocaleString([], {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch {
    return 'unknown';
  }
}

function loadVelocityMap() {
  return storage.velocity.get();
}

function saveVelocityMap(map) {
  storage.velocity.save(map);
}

function pruneVelocityMap(map) {
  const cutoff = now() - (90 * 24 * 60 * 60 * 1000);

  for (const [itemId, entry] of Object.entries(map)) {
    if (!entry || !entry.lastSeenAt || entry.lastSeenAt < cutoff) {
      delete map[itemId];
    }
  }

  return map;
}

function buildVelocitySignature(listings, targetListing = null) {
  const top = listings.slice(0, 3).map(listing => {
    const price = extractPrice(listing);
    const armorRaw = extractArmorRaw(listing);
    return `${price}:${Number.isFinite(armorRaw) ? armorRaw.toFixed(2) : 'na'}`;
  });

  const parts = [
    `count:${listings.length}`,
    `top:${top.join('|')}`
  ];

  const targetArmorRaw = targetListing ? extractArmorRaw(targetListing) : null;
  const bracket = Number.isFinite(targetArmorRaw) ? getArmorBracket(targetArmorRaw) : null;

  if (bracket) {
    const bracketTop = listings
      .filter(listing => {
        const armorRaw = extractArmorRaw(listing);
        return Number.isFinite(armorRaw) && armorRaw >= bracket.min && armorRaw < bracket.max;
      })
      .slice(0, 3)
      .map(listing => {
        const price = extractPrice(listing);
        const armorRaw = extractArmorRaw(listing);
        return `${price}:${Number.isFinite(armorRaw) ? armorRaw.toFixed(2) : 'na'}`;
      });

    parts.push(`bracket:${bracket.label}:${bracketTop.join('|')}`);
  }

  return parts.join('~');
}

function updateVelocityForItem(itemId, signature) {
  let velocityMap = loadVelocityMap();
  velocityMap = pruneVelocityMap(velocityMap);

  const entry = velocityMap[itemId] || {
    score: 0.5,
    samples: 0,
    lastSignature: '',
    lastSeenAt: 0
  };

  const changed = entry.lastSignature && entry.lastSignature !== signature ? 1 : 0;
  const alpha = 0.12;

  if (!entry.lastSignature) {
    entry.score = 0.5;
    entry.samples = 1;
  } else {
    entry.score = (alpha * changed) + ((1 - alpha) * entry.score);
    entry.samples = Math.min((entry.samples || 0) + 1, 9999);
  }

  entry.lastSignature = signature;
  entry.lastSeenAt = now();

  velocityMap[itemId] = entry;
  saveVelocityMap(velocityMap);

  return entry;
}

function getVelocityLabel(itemId) {
  const velocityMap = loadVelocityMap();
  const entry = velocityMap[itemId];

  if (!entry || !Number.isFinite(entry.score)) {
    return null;
  }

  const pct = Math.round(entry.score * 100);

  let label = 'Slow';
  if (pct >= 70) label = 'Fast';
  else if (pct >= 35) label = 'Medium';

  return {
    label,
    pct,
    samples: entry.samples || 0,
    lastSeenAt: entry.lastSeenAt || 0
  };
}

function getStampedMessage(key) {
  const raw = localStore.getItem(key);
  if (!raw) return { message: 'none', at: 0 };

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        message: parsed.message || 'none',
        at: Number(parsed.at) || 0
      };
    }
  } catch {}

  return {
    message: raw,
    at: 0
  };
}

function loadScanStatusMap() {
  return storage.scanStatus.get();
}

function saveScanStatusMap(map) {
  storage.scanStatus.save(map);
}

function setScanStatus(itemId, patch) {
  const map = loadScanStatusMap();
  const prev = map[itemId] || {};
  map[itemId] = {
    ...prev,
    lastSuccessAt: Number(prev.lastSuccessAt || (prev.ok ? prev.at : 0)) || 0,
    ...patch,
    at: now()
  };
  saveScanStatusMap(map);
  requestDebugPanelRefresh();
}

function formatElapsedSince(ts) {
  if (!ts) return 'never';
  const diff = Math.max(0, now() - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

function loadPopupHistory() {
  return storage.popupHistory.get();
}

function savePopupHistory(entries) {
  storage.popupHistory.save(entries);
}

function prunePopupHistory(entries) {
  const cutoff = now() - POPUP_HISTORY_TTL_MS;
  return (Array.isArray(entries) ? entries : [])
    .filter(entry => entry && Number(entry.at) >= cutoff)
    .slice(0, POPUP_HISTORY_MAX);
}

function addPopupHistoryEntry(entry) {
  let entries = prunePopupHistory(loadPopupHistory());

  const normalized = {
    at: now(),
    itemId: Number(entry?.itemId) || 0,
    itemName: String(entry?.itemName || 'Unknown item'),
    text: String(entry?.text || ''),
    tier: String(entry?.tier || 'normal'),
    fingerprint: String(entry?.fingerprint || ''),
    alertIdentity: String(entry?.alertIdentity || ''),
    listingIdentity: String(entry?.listingIdentity || ''),
    sellerIdentity: String(entry?.sellerIdentity || ''),
    price: Number(entry?.price) || 0,
    armor: entry?.armor != null && Number.isFinite(Number(entry.armor)) ? Number(entry.armor) : null,
    quality: entry?.quality != null && Number.isFinite(Number(entry.quality)) ? Number(entry.quality) : null,
    url: String(entry?.url || ''),
    count: 1,
    matchCount: Math.max(1, Math.min(500, Number(entry?.matchCount) || 1)),
    priceHigh: Number(entry?.priceHigh) || Number(entry?.price) || 0,
    targets: Array.isArray(entry?.targets) ? entry.targets.slice(0,5).map(normalizeListingTarget).filter(Boolean) : [],
    summaries: Array.isArray(entry?.summaries) ? entry.summaries.slice(0,5).map(value => String(value).slice(0,600)) : []
  };

  const existingIndex = entries.findIndex(existing => {
    if (!existing) return false;

    const existingAlertIdentity = String(existing.alertIdentity || '').trim();
    const normalizedAlertIdentity = String(normalized.alertIdentity || '').trim();

    if (normalizedAlertIdentity && existingAlertIdentity) {
      return existingAlertIdentity === normalizedAlertIdentity;
    }

    const existingFingerprint = String(existing.fingerprint || '').trim();
    const normalizedFingerprint = String(normalized.fingerprint || '').trim();

    if (normalizedFingerprint && existingFingerprint) {
      return existingFingerprint === normalizedFingerprint;
    }

    return (
      Number(existing.itemId || 0) === normalized.itemId &&
      Number(existing.price || 0) === normalized.price &&
      String(existing.sellerIdentity || '').trim() === String(normalized.sellerIdentity || '').trim() &&
      String(existing.url || '').trim() === normalized.url.trim()
    );
  });

  if (existingIndex >= 0) {
    const existing = entries[existingIndex] || {};
    entries[existingIndex] = {
      ...existing,
      ...normalized,
      count: Math.max(1, Number(existing.count) || 1) + 1
    };

    const updated = entries.splice(existingIndex, 1)[0];
    entries.unshift(updated);
  } else {
    entries.unshift(normalized);
  }

  savePopupHistory(prunePopupHistory(entries));
}

function clearPopupHistory() {
  savePopupHistory([]);
  requestDebugPanelRefresh(true);
}

function buildAlertIdentity(match) {
    return makeFingerprint(match.itemRule, match.listing);
  }

function hasRecentPopupAlert(alertIdentity, fingerprint = '') {
  const normalizedAlertIdentity = String(alertIdentity || '').trim();
  const normalizedFingerprint = String(fingerprint || '').trim();
  if (!normalizedAlertIdentity && !normalizedFingerprint) return false;

  const entries = prunePopupHistory(loadPopupHistory());
  return entries.some(entry => {
    const entryAlertIdentity = String(entry?.alertIdentity || '').trim();
    const entryFingerprint = String(entry?.fingerprint || '').trim();

    if (normalizedAlertIdentity && entryAlertIdentity && normalizedAlertIdentity === entryAlertIdentity) {
      return true;
    }

    return !!(normalizedFingerprint && entryFingerprint && normalizedFingerprint === entryFingerprint);
  });
}

function shouldSuppressPopupAlert(match, payload) {
    // History is an audit trail; the user-selected cooldown controls re-alerts.
    return false;
  }

function sanitizeImportedWatchRule(rawRule, fallbackIndex = 0) {
  if (!rawRule || typeof rawRule !== 'object') return null;

  const itemId = Number(rawRule.itemId);
  if (!Number.isSafeInteger(itemId) || itemId <= 0) return null;

  const catalogItem = ITEM_CATALOG.find(item => item.itemId === itemId);
  const rawName = String(rawRule.rawName || catalogItem?.rawName || '').trim();
  const displayName = String(rawRule.displayName || catalogItem?.displayName || prettifyCatalogName(rawName || `item_${itemId}`)).trim();

  return {
    id: String(rawRule.id || `watch_${itemId}_${fallbackIndex}`),
    itemId,
    rawName: rawName || displayName.toLowerCase().replace(/\s+/g, '_'),
    displayName: displayName.slice(0, 120),
    enabled: typeof rawRule.enabled === 'boolean' ? rawRule.enabled : true,
    useMV: typeof rawRule.useMV === 'boolean' ? rawRule.useMV : true,
    maxMultiplier: bounded(rawRule.maxMultiplier, 1.10, 0.01, 100),
    maxPrice: normalizeFixedPrice(rawRule.maxPrice),
    group: normalizeGroup(rawRule.group),
    minArmor: rawRule.minArmor === '' || rawRule.minArmor === null || typeof rawRule.minArmor === 'undefined'
      ? ''
      : String(bounded(rawRule.minArmor, 1, 0, 10000)),
    minQuality: rawRule.minQuality === '' || rawRule.minQuality === null || typeof rawRule.minQuality === 'undefined'
      ? ''
      : String(bounded(rawRule.minQuality, 1, 0, 10000)),
    pagesToScan: Math.min(5, Math.max(1, Math.floor(Number(rawRule.pagesToScan) || 1)))
  };
}

function buildWatchlistExportPayload() {
  return {
    type: 'umw_watchlist_export',
    version: getScriptVersion(),
    exportedAt: new Date().toISOString(),
    watchlist: getWatchlist().map((itemRule, index) => sanitizeImportedWatchRule(itemRule, index)).filter(Boolean)
  };
}

async function copyTextToClipboard(textValue) {
  const normalized = String(textValue || '');
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(normalized);
    return true;
  }

  const temp = document.createElement('textarea');
  temp.value = normalized;
  temp.style.position = 'fixed';
  temp.style.left = '-9999px';
  document.body.appendChild(temp);
  temp.select();

  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }

  temp.remove();
  return ok;
}

function triggerTextDownload(filename, textValue) {
  const blob = new Blob([String(textValue || '')], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportWatchlistFilters() {
  const payload = buildWatchlistExportPayload();
  const pretty = JSON.stringify(payload, null, 2);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `umw-watchlist-${stamp}.json`;

  let copied = false;
  try {
    copied = await copyTextToClipboard(pretty);
  } catch {
    copied = false;
  }

  triggerTextDownload(fileName, pretty);
  alert(copied
    ? 'Watchlist filters copied to clipboard and downloaded as a JSON file.'
    : 'Watchlist filters downloaded as a JSON file. Clipboard copy was not available.');
}

function importWatchlistFiltersFromText(rawText) {
  if (String(rawText || '').length > 1000000) throw new Error('Import is too large (1 MB maximum).');
  const parsed = JSON.parse(String(rawText || '').trim());
  const sourceList = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.watchlist)
      ? parsed.watchlist
      : Array.isArray(parsed?.filters)
        ? parsed.filters
        : null;

  if (!sourceList) {
    throw new Error('Import data must be a watchlist array or an export bundle with a watchlist field.');
  }

  const cleaned = sourceList
    .map((itemRule, index) => sanitizeImportedWatchRule(itemRule, index))
    .filter(Boolean);

  if (!cleaned.length) {
    throw new Error('No valid watchlist entries were found in the import data.');
  }

  const choice = window.prompt('Type REPLACE or MERGE. Cancel leaves your watchlist unchanged.', 'MERGE');
  if (choice === null) return { mode: 'cancelled', count: getWatchlist().length };
  if (!['REPLACE', 'MERGE'].includes(choice.trim().toUpperCase())) throw new Error('Choose REPLACE or MERGE.');
  const replaceAll = choice.trim().toUpperCase() === 'REPLACE';

  if (replaceAll) {
    saveWatchlist(cleaned);
    return {
      mode: 'replaced',
      count: cleaned.length
    };
  }

  const existing = getWatchlist();
  const mergedMap = new Map(existing.map((itemRule, index) => [String(itemRule.itemId), sanitizeImportedWatchRule(itemRule, index)]));
  cleaned.forEach((itemRule, index) => {
    mergedMap.set(String(itemRule.itemId), sanitizeImportedWatchRule(itemRule, index));
  });

  const merged = Array.from(mergedMap.values()).filter(Boolean);
  saveWatchlist(merged);
  return {
    mode: 'merged',
    count: merged.length
  };
}

async function promptImportWatchlistFilters() {
  let pasted = '';
  try {
    if (navigator?.clipboard?.readText) {
      pasted = await navigator.clipboard.readText();
    }
  } catch {
    pasted = '';
  }

  const rawInput = window.prompt(
    'Paste exported watchlist JSON below.',
    pasted || ''
  );

  if (rawInput === null) return;

  const result = importWatchlistFiltersFromText(rawInput);
  requestDebugPanelRefresh(true);
  alert(`Filters ${result.mode}. Current watchlist size: ${result.count}.`);
}

  function isEnabled() {
    const raw = localStore.getItem(STORAGE_KEYS.enabled);
    if (raw === null) return true;
    return raw === 'true';
  }

  function setEnabled(value) {
  cancelScans();
  localStore.setItem(STORAGE_KEYS.enabled, value ? 'true' : 'false');

  // Stop membership refresh when disabled
  if (!value && membershipRefreshTimer) {
    clearInterval(membershipRefreshTimer);
    membershipRefreshTimer = null;
  }

  // Restart it when enabled
  if (value && !membershipRefreshTimer) {
    startMembershipRefreshLoop();
    getRwModule().resume();
  }
}

  function setWatcherEnabledState(value) {
    const next = !!value;
    setEnabled(next);
    if(next && rwModule) rwModule.resume();
    if (!next) clearToasts();
    updateBadge();
    requestDebugPanelRefresh(true);
    if (next && isLeader && isMembershipActive()) runLoop();
  }

  function isDebugVisible() {
    return localStore.getItem(STORAGE_KEYS.debugVisible) === 'true';
  }

  function setDebugVisible(value) {
    localStore.setItem(STORAGE_KEYS.debugVisible, value ? 'true' : 'false');
    updateBadge();
  }

  function isDebugPanelMinimized() {
    return localStore.getItem(STORAGE_KEYS.debugPanelMinimized) === 'true';
  }

  function setDebugPanelMinimized(value) {
    localStore.setItem(STORAGE_KEYS.debugPanelMinimized, value ? 'true' : 'false');
  }


  function getDebugPanelPos() {
    return getJson(STORAGE_KEYS.debugPanelPos, null);
  }

  function saveDebugPanelPos(pos) {
    setJson(STORAGE_KEYS.debugPanelPos, pos);
  }

  function getDebugPanelSize() {
    return getJson(STORAGE_KEYS.debugPanelSize, null);
  }

  function saveDebugPanelSize(size) {
    if (!size) return;
    setJson(STORAGE_KEYS.debugPanelSize, {
      width: Math.max(330, Math.floor(Number(size.width) || 330)),
      height: Math.max(180, Math.floor(Number(size.height) || 180))
    });
  }

  function applyDebugPanelSize(size) {
    if (!debugPanelEl || !size) return;

    const width = Math.max(330, Math.floor(Number(size.width) || 330));
    const height = Math.max(180, Math.floor(Number(size.height) || 180));

    debugPanelEl.style.width = `${Math.min(width, window.innerWidth - 20)}px`;
    debugPanelEl.style.height = `${Math.min(height, window.innerHeight - 20)}px`;
    debugPanelEl.style.maxWidth = 'calc(100vw - 20px)';
    debugPanelEl.style.maxHeight = 'calc(100vh - 20px)';
  }

  function clampDebugPanelPos(left, top) {
    const panelWidth = debugPanelEl ? debugPanelEl.offsetWidth || 330 : 330;
    const panelHeight = debugPanelEl ? debugPanelEl.offsetHeight || 200 : 200;
    const maxLeft = Math.max(10, window.innerWidth - panelWidth - 10);
    const maxTop = Math.max(10, window.innerHeight - panelHeight - 10);

    return {
      left: Math.min(Math.max(10, left), maxLeft),
      top: Math.min(Math.max(10, top), maxTop)
    };
  }

  function applyDebugPanelPos(pos) {
    if (!debugPanelEl || !pos) return;

    const clamped = clampDebugPanelPos(Number(pos.left) || 10, Number(pos.top) || 10);
    debugPanelEl.style.left = `${clamped.left}px`;
    debugPanelEl.style.top = `${clamped.top}px`;
    debugPanelEl.style.transform = 'none';
  }

function enableDebugPanelDrag(handleEl) {
    handleEl.style.cursor = 'move';
    handleEl.style.touchAction = 'none';
    handleEl.onpointerdown = event => {
      if (event.target.closest('button, input, textarea, select, label')) return;
      if (event.button !== 0) return;
      event.preventDefault();
      uiState.dragging = true;
      const panel = debugPanelEl;
      const rect = panel.getBoundingClientRect();
      const dx = event.clientX - rect.left, dy = event.clientY - rect.top;
      handleEl.setPointerCapture(event.pointerId);
      handleEl.onpointermove = move => applyDebugPanelPos({ left: move.clientX - dx, top: move.clientY - dy });
      const end = () => {
        uiState.dragging = false;
        saveDebugPanelPos({ left: parseFloat(panel.style.left) || rect.left, top: parseFloat(panel.style.top) || rect.top });
        handleEl.onpointermove = null;
        handleEl.onpointerup = null;
        handleEl.onpointercancel = null;
      };
      handleEl.onpointerup = end;
      handleEl.onpointercancel = end;
    };
  }

function getSettings() {
    const stored = storage.settings.get();
    return { ...stored,
      pollMs: Math.floor(bounded(stored.pollMs, DEFAULTS.pollMs, 5000, 3600000)),
      alertCooldownMs: Math.floor(bounded(stored.alertCooldownMs, DEFAULTS.alertCooldownMs, 0, 86400000)),
      soundVolume: bounded(stored.soundVolume, DEFAULTS.soundVolume, 0, 300),
      soundPreset: ['classic', 'arcade', 'alarm'].includes(stored.soundPreset) ? stored.soundPreset : 'classic'
    };
  }

  function saveSettings(settings) {
    cancelScans();
    storage.settings.save(settings);
    requestDebugPanelRefresh(true);
  }

function getWatchlist() {
    const unique = new Map();
    for (const [index, raw] of storage.watchlist.get().slice(0, 500).entries()) {
      const rule = sanitizeImportedWatchRule(raw, index);
      if (rule) unique.set(rule.itemId, rule);
    }
    return [...unique.values()];
  }

  function saveWatchlist(list) {
    cancelScans();
    storage.watchlist.save(list.slice(0, 500).map(sanitizeImportedWatchRule).filter(Boolean));
    requestDebugPanelRefresh(true);
  }

  function prettifyCatalogName(raw) {
    return raw
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  function normalizeCatalogNameToKey(name) {
    return String(name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function parseCatalog(rawText) {
    const lines = rawText
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);

    const items = [];

    for (const line of lines) {
      let itemId = NaN;
      let rawName = '';
      let displayName = '';

      const csvMatch = line.match(/^(\d+)\s*,\s*(.+)$/);
      const legacyMatch = line.match(/^(.*)\s+(\d+)$/);

      if (csvMatch) {
        itemId = Number(csvMatch[1]);
        displayName = String(csvMatch[2] || '').trim();
        rawName = normalizeCatalogNameToKey(displayName);
      } else if (legacyMatch) {
        rawName = legacyMatch[1].trim();
        itemId = Number(legacyMatch[2]);
        displayName = prettifyCatalogName(rawName);
      }

      if (!displayName || !Number.isFinite(itemId)) continue;

      items.push({
        rawName: rawName || normalizeCatalogNameToKey(displayName),
        displayName,
        itemId
      });
    }

    return items;
  }

  const ITEM_CATALOG = parseCatalog(ITEM_CATALOG_RAW);

  function searchCatalog(query, excludeIds = new Set()) {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    return ITEM_CATALOG
      .filter(item => !excludeIds.has(item.itemId))
      .filter(item =>
        item.displayName.toLowerCase().includes(q) ||
        item.rawName.toLowerCase().includes(q) ||
        String(item.itemId) === q
      )
      .slice(0, 12);
  }


  function bindClick(element, handler) {
    if (!element || typeof handler !== 'function') return;
    element.addEventListener('click', handler);
  }

  function ensureBadge() {
    if (badgeEl && document.body.contains(badgeEl)) return;
    const wrap = document.createElement('div'); wrap.id = 'umw-badge-wrap';
    badgeEl = document.createElement('button'); badgeEl.id = 'umw-badge'; badgeEl.type = 'button';
    badgeEl.addEventListener('click', () => {
      setDebugVisible(!isDebugVisible()); setDebugPanelMinimized(false); rebuildDebugPanel();
      if (isDebugVisible()) requestAnimationFrame(() => debugPanelEl?.querySelector('[data-close]')?.focus());
    });
    wrap.append(badgeEl); document.body.append(wrap);
  }

  function updateBadge() {
    ensureBadge();
    const state = !isEnabled() ? 'Paused' : !isMembershipActive() ? 'Set up' : !getEffectiveApiKey() ? 'Add key' : 'Watching';
    badgeEl.replaceChildren();
    const dot = document.createElement('span'); dot.className = 'umw-dot';
    const label = document.createElement('span'); label.className = 'umw-launch-label'; label.textContent = 'Market Watcher';
    const compact = document.createElement('span'); compact.className = 'umw-launch-compact'; compact.textContent = 'MW'; compact.setAttribute('aria-hidden', 'true');
    badgeEl.append(dot, label, compact);
    const status = document.createElement('span'); status.className = 'umw-launch-status'; status.textContent = state;
    badgeEl.append(status); badgeEl.dataset.active = String(state === 'Watching');
    badgeEl.setAttribute('aria-label', 'Open Market Watcher · ' + state);
    badgeEl.setAttribute('aria-expanded', String(isDebugVisible()));
    badgeEl.title = 'Open Market Watcher';
  }


  function ensureToastWrap() {
    if (toastWrap && document.body.contains(toastWrap)) return;

    toastWrap = document.createElement('div');
    toastWrap.id = 'umw-toasts';
    toastWrap.setAttribute('aria-live', 'polite');
    toastWrap.setAttribute('aria-label', 'Market alerts');
    toastWrap.style.maxHeight = '45vh';
    toastWrap.style.overflowY = 'auto';
    toastWrap.style.position = 'fixed';
    toastWrap.style.left = '10px';
    toastWrap.style.right = '10px';
    toastWrap.style.bottom = '60px';
    toastWrap.style.zIndex = '999999';
    toastWrap.style.display = 'flex';
    toastWrap.style.flexDirection = 'column';
    toastWrap.style.gap = '6px';
    toastWrap.style.pointerEvents = 'none';

    (document.body || document.documentElement).appendChild(toastWrap);
  }

  function clearToasts() {
    ensureToastWrap();
    toastWrap.innerHTML = '';
  }

  function removePopup(el) {
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px) scale(0.98)';
    el.style.height = `${el.offsetHeight}px`;

    requestAnimationFrame(() => {
      el.style.height = '0px';
      el.style.margin = '0';
      el.style.paddingTop = '0';
      el.style.paddingBottom = '0';
      el.style.borderWidth = '0';
    });

    setTimeout(() => {
      if (el.parentNode) el.remove();
    }, 180);
  }

  function getTier(diffPct, hasPriceRule) {
    if (!hasPriceRule) return 'normal';
    if (diffPct <= -20) return 'insane';
    if (diffPct <= -10) return 'strong';
    return 'normal';
  }

  function getTierStyle(tier) {
    if (tier === 'insane') {
      return {
        title: 'Insane hit',
        background: 'rgba(72,12,12,0.97)',
        border: 'rgba(255,90,90,0.35)'
      };
    }
    if (tier === 'strong') {
      return {
        title: 'Strong hit',
        background: 'rgba(68,52,10,0.97)',
        border: 'rgba(255,220,90,0.30)'
      };
    }
    return {
      title: 'Normal hit',
      background: 'rgba(20,20,20,0.96)',
      border: 'rgba(255,255,255,0.12)'
    };
  }

  function vibrateForTier(tier) {
    const settings = getSettings();
    if (!settings.vibrationEnabled) return;
    if (!('vibrate' in navigator)) return;

    try {
      if (tier === 'insane') navigator.vibrate([120, 60, 120]);
      else if (tier === 'strong') navigator.vibrate([90, 50, 90]);
      else navigator.vibrate(60);
    } catch {}
  }

function canUseDesktopNotifications() {
  return typeof Notification !== 'undefined';
}

async function requestDesktopNotificationPermission() {
  if (!canUseDesktopNotifications()) return 'unsupported';

  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

function getDesktopNotificationPermissionState() {
  return canUseDesktopNotifications() ? Notification.permission : 'unsupported';
}

function syncDesktopNotificationControls(notifLabel, notifBtn) {
  const state = getDesktopNotificationPermissionState();
  notifLabel.textContent = `Notification permission: ${state}`;

  if (state === 'granted') {
    notifBtn.textContent = getSettings().desktopNotificationsEnabled ? 'Disable notifications' : 'Enable notifications';
    notifBtn.title = 'Disables script notifications. Browser permission must still be removed manually in site settings.';
    return;
  }

  if (state === 'denied') {
    notifBtn.textContent = 'Reset in browser';
    notifBtn.title = 'Notification permission is blocked. Reset it manually in browser site settings.';
    return;
  }

  if (state === 'unsupported') {
    notifBtn.textContent = 'Unsupported';
    notifBtn.title = 'Desktop notifications are not supported in this browser.';
    return;
  }

  notifBtn.textContent = 'Enable notifications';
  notifBtn.title = 'Request desktop notification permission.';
}

async function handleDesktopNotificationButtonClick(notifLabel, notifBtn) {
  const state = getDesktopNotificationPermissionState();

  if (state === 'unsupported') {
    syncDesktopNotificationControls(notifLabel, notifBtn);
    alert('Desktop notifications are not supported in this browser.');
    return;
  }

  if (state === 'granted') {
    const next = getSettings();
    next.desktopNotificationsEnabled = !next.desktopNotificationsEnabled;
    saveSettings(next);
    syncDesktopNotificationControls(notifLabel, notifBtn);
    if (next.desktopNotificationsEnabled) return;
    alert('Desktop notifications were disabled in the script. Browser notification permission cannot be revoked by a website or userscript, so if you also want the permission removed you will need to clear it manually in your browser site settings for torn.com.');
    return;
  }

  if (state === 'denied') {
    const next = getSettings();
    next.desktopNotificationsEnabled = false;
    saveSettings(next);
    syncDesktopNotificationControls(notifLabel, notifBtn);
    alert('Notification permission is currently blocked by the browser. Websites cannot remove or reset that permission themselves, so you will need to change it manually in your browser site settings for torn.com and then click this button again.');
    return;
  }

  const result = await requestDesktopNotificationPermission();

  if (result === 'granted') {
    const next = getSettings();
    next.desktopNotificationsEnabled = true;
    saveSettings(next);
  }

  syncDesktopNotificationControls(notifLabel, notifBtn);
}

function showDesktopNotification(title, body, url, onOpen) {
  const settings = getSettings();
  if (!settings.desktopNotificationsEnabled) return;
  if (!canUseDesktopNotifications()) return;
  if (Notification.permission !== 'granted') return;

  try {
    const n = new Notification(title, {
      body,
      icon: 'https://www.torn.com/favicon.ico',
      tag: 'umw-market-alert-' + url,
      requireInteraction: false
    });

    n.onclick = () => {
      try {
        window.focus();
        if (onOpen) onOpen(); else if (url) window.open(url, '_blank', 'noopener,noreferrer');
      } catch {}
      try { n.close(); } catch {}
    };

    setTimeout(() => {
      try { n.close(); } catch {}
    }, 10000);
  } catch (err) {
    console.error('[UMW] Desktop notification failed:', err);
  }
}

  function unlockAudioContext() {
    if (audioCtx) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = new Ctx();
    } catch {}
  }

function beep(freq, duration, volume = 0.03, type = 'sine') {
  if (!audioCtx) return;

  try {
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    const safeVolume = bounded(volume, 0.03, 0, 3);
    if (safeVolume === 0) return;

    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = safeVolume;

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const start = audioCtx.currentTime;
    const end = start + duration;

    gain.gain.setValueAtTime(safeVolume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.start(start);
    osc.stop(end);
  } catch {}
}

function playClassicTierSound(tier, volumeMul) {
  if (tier === 'insane') {
    beep(880, 0.10, 0.04 * volumeMul, 'sine');
    setTimeout(() => beep(1175, 0.12, 0.04 * volumeMul, 'sine'), 120);
  } else if (tier === 'strong') {
    beep(740, 0.11, 0.035 * volumeMul, 'sine');
  } else {
    beep(620, 0.08, 0.03 * volumeMul, 'sine');
  }
}

function playArcadeTierSound(tier, volumeMul) {
  if (tier === 'insane') {
    beep(720, 0.08, 0.05 * volumeMul, 'square');
    setTimeout(() => beep(960, 0.08, 0.05 * volumeMul, 'square'), 90);
    setTimeout(() => beep(1240, 0.12, 0.055 * volumeMul, 'square'), 180);
  } else if (tier === 'strong') {
    beep(700, 0.07, 0.045 * volumeMul, 'triangle');
    setTimeout(() => beep(920, 0.09, 0.045 * volumeMul, 'triangle'), 80);
  } else {
    beep(650, 0.07, 0.04 * volumeMul, 'triangle');
  }
}

function playAlarmTierSound(tier, volumeMul) {
  if (tier === 'insane') {
    beep(980, 0.14, 0.06 * volumeMul, 'sawtooth');
    setTimeout(() => beep(980, 0.14, 0.06 * volumeMul, 'sawtooth'), 170);
  } else if (tier === 'strong') {
    beep(820, 0.12, 0.05 * volumeMul, 'sawtooth');
  } else {
    beep(700, 0.10, 0.04 * volumeMul, 'sawtooth');
  }
}

function soundForTier(tier) {
  const settings = getSettings();
  if (!settings.soundEnabled) return;

  unlockAudioContext();
  if (!audioCtx) return;

  try {
    const volumeMul = bounded(settings.soundVolume, 100, 0, 300) / 100;
    if (volumeMul === 0) return;
    const preset = String(settings.soundPreset || 'classic');

    if (preset === 'arcade') {
      playArcadeTierSound(tier, volumeMul);
      return;
    }

    if (preset === 'alarm') {
      playAlarmTierSound(tier, volumeMul);
      return;
    }

    playClassicTierSound(tier, volumeMul);
  } catch {}
}
  function showToast(title, text, tier, onOpen, actionLabel) {
    if (!isEnabled()) return;
    ensureToastWrap();
    const el = document.createElement('article'); el.className = 'umw-alert-toast'; el.dataset.tier = tier;
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'umw-toast-copy';
    copy.setAttribute('aria-label', actionLabel || ('Open ' + title + ' on the item market'));
    const eyebrow = document.createElement('span'); eyebrow.className = 'umw-eyebrow'; eyebrow.textContent = 'MATCH FOUND';
    const heading = document.createElement('strong'); heading.textContent = title;
    const body = document.createElement('span'); body.textContent = text;
    copy.append(eyebrow, heading, body); copy.addEventListener('click', () => { onOpen(); el.remove(); });
    const close = document.createElement('button'); close.type = 'button'; close.className = 'umw-toast-close';
    close.textContent = '×'; close.setAttribute('aria-label', 'Dismiss alert'); close.onclick = () => el.remove();
    el.append(copy, close);
    while (toastWrap.children.length >= 8) toastWrap.firstElementChild.remove();
    toastWrap.append(el); vibrateForTier(tier); soundForTier(tier);
  }


  function ensureDebugPanel() {
    if (debugPanelEl && document.body.contains(debugPanelEl)) return;
    debugPanelEl = document.createElement('section'); debugPanelEl.id = 'umw-debug-panel';
    debugPanelEl.setAttribute('role', 'region'); debugPanelEl.setAttribute('aria-label', 'Market Watcher');
    debugPanelEl.addEventListener('focusout', event => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) && event.target.type !== 'checkbox') {
        setTimeout(() => requestDebugPanelRefresh(), 0);
      }
    });
    debugPanelEl.addEventListener('keydown', event => {
      if (event.key === 'Escape') { setDebugVisible(false); rebuildDebugPanel(); badgeEl?.focus(); }
    });
    document.body.append(debugPanelEl);
    attachPanelWindow(debugPanelEl);
  }


  function rebuildDebugPanel() {
    if (debugPanelEl && document.body.contains(debugPanelEl)) {
      debugPanelEl.remove();
      debugPanelEl = null;
    }
    if (isDebugVisible()) {
      ensureDebugPanel();
      requestDebugPanelRefresh(true);
    }
  }



  function estimateApiUsagePerMinute() {
    const settings = getSettings();
    const watchlist = getWatchlist().filter(item => item && isRuleScanning(item));

    const pollMs = Math.max(1000, Number(settings.pollMs) || DEFAULTS.pollMs);
    const cyclesPerMinute = 60000 / pollMs;

    const requestsPerCycle = watchlist.reduce((sum, item) => {
      const pages = Math.min(5, Math.max(1, Math.floor(Number(item?.pagesToScan) || 1)));
      return sum + pages;
    }, 0);

    return {
      enabledItems: watchlist.length,
      requestsPerCycle,
      requestsPerMinute: requestsPerCycle * cyclesPerMinute
    };
  }



function sanitizePresetName(rawName) {
    const name = String(rawName || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    return ['__proto__', 'constructor', 'prototype'].includes(name) ? '' : name;
  }

function normalizePresetBundle(rawBundle) {
  if (!rawBundle) return {};

  if (Array.isArray(rawBundle)) {
    const normalized = Object.create(null);
    rawBundle.forEach((entry, index) => {
      const name = sanitizePresetName(entry?.name || `Preset ${index + 1}`);
      const watchlist = Array.isArray(entry?.watchlist)
        ? entry.watchlist.map((itemRule, itemIndex) => sanitizeImportedWatchRule(itemRule, itemIndex)).filter(Boolean)
        : [];
      if (!name || !watchlist.length) return;
      normalized[name] = {
        name,
        savedAt: Number(entry?.savedAt || Date.now()),
        watchlist
      };
    });
    return normalized;
  }

  if (typeof rawBundle === 'object') {
    const normalized = Object.create(null);
    Object.entries(rawBundle).forEach(([key, entry], index) => {
      const name = sanitizePresetName(entry?.name || key || `Preset ${index + 1}`);
      const sourceWatchlist = Array.isArray(entry?.watchlist)
        ? entry.watchlist
        : Array.isArray(entry)
          ? entry
          : [];
      const watchlist = sourceWatchlist
        .map((itemRule, itemIndex) => sanitizeImportedWatchRule(itemRule, itemIndex))
        .filter(Boolean);
      if (!name || !watchlist.length) return;
      normalized[name] = {
        name,
        savedAt: Number(entry?.savedAt || Date.now()),
        watchlist
      };
    });
    return normalized;
  }

  return {};
}

function getPresetBundle() {
  return normalizePresetBundle(storage.presets.get());
}

function savePresetBundle(bundle) {
  storage.presets.save(normalizePresetBundle(bundle));
  requestDebugPanelRefresh(true);
}

function getPresetEntries() {
  return Object.values(getPresetBundle())
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

function saveCurrentWatchlistAsPreset(name) {
  const safeName = sanitizePresetName(name);
  if (!safeName) {
    throw new Error('Preset name cannot be empty.');
  }

  const watchlist = getWatchlist()
    .map((itemRule, index) => sanitizeImportedWatchRule(itemRule, index))
    .filter(Boolean);

  if (!watchlist.length) {
    throw new Error('Your current watchlist is empty.');
  }

  const bundle = getPresetBundle();
  bundle[safeName] = {
    name: safeName,
    savedAt: Date.now(),
    watchlist
  };
  savePresetBundle(bundle);
}

function loadPresetIntoWatchlist(name, mode = 'replace') {
  const safeName = sanitizePresetName(name);
  const bundle = getPresetBundle();
  const preset = bundle[safeName];

  if (!preset || !Array.isArray(preset.watchlist) || !preset.watchlist.length) {
    throw new Error(`Preset "${safeName}" was not found.`);
  }

  const cleaned = preset.watchlist
    .map((itemRule, index) => sanitizeImportedWatchRule(itemRule, index))
    .filter(Boolean);

  if (!cleaned.length) {
    throw new Error(`Preset "${safeName}" has no valid watchlist entries.`);
  }

  if (mode === 'merge') {
    const existing = getWatchlist();
    const mergedMap = new Map(existing.map((itemRule, index) => [String(itemRule.itemId), sanitizeImportedWatchRule(itemRule, index)]));
    cleaned.forEach((itemRule, index) => {
      mergedMap.set(String(itemRule.itemId), sanitizeImportedWatchRule(itemRule, index));
    });
    saveWatchlist(Array.from(mergedMap.values()).filter(Boolean));
    return;
  }

  saveWatchlist(cleaned);
}

function deletePreset(name) {
  const safeName = sanitizePresetName(name);
  const bundle = getPresetBundle();
  if (!bundle[safeName]) return;
  delete bundle[safeName];
  savePresetBundle(bundle);
}

  function buildDebugPanelViewModel() {
    const settings = getSettings();
    const watchlist = getWatchlist();
    const popupHistory = prunePopupHistory(loadPopupHistory());

    return {
      version: getScriptVersion(),
      settings,
      watchlist,
      lastAlert: getStampedMessage(STORAGE_KEYS.lastAlert),
      lastError: getStampedMessage(STORAGE_KEYS.lastError),
      lastScanAt: getNumber(STORAGE_KEYS.lastScanAt, 0),
      lastValueFetch: getNumber(STORAGE_KEYS.lastValueFetch, 0),
      marketValues: getJson(STORAGE_KEYS.marketValues, {}),
      scanStatusMap: loadScanStatusMap(),
      popupHistory,
      presets: getPresetEntries(),
      membership: { ...membershipState, active: isMembershipActive() },
      apiEstimate: estimateApiUsagePerMinute(),
      isEnabled: isEnabled(),
      isLeader,
      isRunningLoop,
      isMinimized: isDebugPanelMinimized()
    };
  }

  function requestDebugPanelRefresh(force = false) {
    if (!isDebugVisible()) return;

    debugRenderState.pendingForce = debugRenderState.pendingForce || !!force;
    if (debugRenderState.scheduled) return;

    debugRenderState.scheduled = true;

    requestAnimationFrame(() => {
      const scheduledForce = debugRenderState.pendingForce;
      debugRenderState.scheduled = false;
      debugRenderState.pendingForce = false;
      refreshDebugPanel(scheduledForce);
    });
  }

  const PANEL_LAYOUT_KEY='umw_panel_layout_v720';
  let panelRect=null, panelRestore=null, panelGesture=null;
  function panelViewport(){return {w:Math.max(1,window.innerWidth),h:Math.max(1,window.visualViewport?.height||window.innerHeight)};}
  function panelLayoutMode(){return window.innerWidth<=600?'phone':'desktop';}
  function clampPanelRect(rect){
    const {w,h}=panelViewport(),gap=8,maxW=Math.max(1,w-gap*2),maxH=Math.max(1,h-gap*2);
    const finite=(n,fallback)=>Number.isFinite(Number(n))?Number(n):fallback;
    const width=Math.min(maxW,Math.max(Math.min(300,maxW),finite(rect?.width,840)));
    const height=Math.min(maxH,Math.max(Math.min(330,maxH),finite(rect?.height,760)));
    return {width,height,x:Math.max(gap,Math.min(w-width-gap,finite(rect?.x,(w-width)/2))),y:Math.max(gap,Math.min(h-height-gap,finite(rect?.y,8)))};
  }
  function defaultPanelRect(){const {w,h}=panelViewport();const width=Math.min(840,w-16),height=Math.min(760,h-(w<=600?80:60));return clampPanelRect({width,height,x:(w-width)/2,y:w<=600?8:(h-height)/2});}
  function loadPanelRect(){const saved=getJson(PANEL_LAYOUT_KEY,{});return saved[panelLayoutMode()]?clampPanelRect(saved[panelLayoutMode()]):defaultPanelRect();}
  function savePanelRect(){const saved=getJson(PANEL_LAYOUT_KEY,{});saved[panelLayoutMode()]=panelRect;setJson(PANEL_LAYOUT_KEY,saved);}
  function applyPanelRect(){
    if(!debugPanelEl)return;
    panelRect=panelRect||loadPanelRect();
    const fitted=clampPanelRect(panelRect);
    Object.assign(debugPanelEl.style,{left:fitted.x+'px',top:fitted.y+'px',width:fitted.width+'px',height:fitted.height+'px',transform:'none'});
    debugPanelEl.dataset.layout=fitted.width<560?'compact':fitted.width>=780?'wide':'normal';
    debugPanelEl.dataset.short=String(fitted.height<540);
  }
  function resetPanelLayout(){panelRestore=null;panelRect=defaultPanelRect();savePanelRect();applyPanelRect();requestDebugPanelRefresh();}
  function togglePanelExpand(){
    if(panelRestore){panelRect=clampPanelRect(panelRestore);panelRestore=null;}
    else{panelRestore={...panelRect};const {w,h}=panelViewport();panelRect=clampPanelRect({x:8,y:8,width:w-16,height:h-16});}
    savePanelRect();applyPanelRect();requestDebugPanelRefresh();
  }
  function attachPanelWindow(panel){
    panelRect=loadPanelRect();panelRestore=null;applyPanelRect();
    panel.addEventListener('pointerdown',event=>{
      const resize=event.target.closest('[data-panel-resize]');
      const move=event.target.closest('[data-panel-move]') || (event.target.closest('.umw-header')&&!event.target.closest('button,input,a,select'));
      if((!resize&&!move)||event.button!==0)return;
      event.preventDefault();panelGesture={id:event.pointerId,x:event.clientX,y:event.clientY,rect:clampPanelRect(panelRect),resize:!!resize};
      uiState.dragging=true;panelRestore=null;panel.setPointerCapture(event.pointerId);
    });
    panel.addEventListener('pointermove',event=>{
      if(!panelGesture||panelGesture.id!==event.pointerId)return;
      const {rect,x,y,resize}=panelGesture,dx=event.clientX-x,dy=event.clientY-y;
      panelRect=clampPanelRect(resize?{...rect,width:rect.width+dx,height:rect.height+dy}:{...rect,x:rect.x+dx,y:rect.y+dy});applyPanelRect();
    });
    const finish=event=>{if(!panelGesture||event.pointerId!==panelGesture.id)return;panelGesture=null;uiState.dragging=false;savePanelRect();requestDebugPanelRefresh();};
    panel.addEventListener('pointerup',finish);panel.addEventListener('pointercancel',finish);panel.addEventListener('lostpointercapture',finish);
    panel.addEventListener('keydown',event=>{
      const resize=event.target.closest('[data-panel-resize]'),move=event.target.closest('[data-panel-move]');
      if((!resize&&!move)||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
      event.preventDefault();const step=event.shiftKey?40:10;
      const dx=event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,dy=event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0;
      panelRestore=null;panelRect=clampPanelRect(resize?{...panelRect,width:panelRect.width+dx,height:panelRect.height+dy}:{...panelRect,x:panelRect.x+dx,y:panelRect.y+dy});savePanelRect();applyPanelRect();
    });
  }
  function panelWindowControls(header,brand,close){
    const tools=uiNode('div','umw-window-tools');
    const move=uiButton('⠿',()=>{},'umw-window-button');move.dataset.panelMove='';move.setAttribute('aria-label','Move panel');move.title='Drag to move. Arrow keys also move the panel.';
    const expand=uiButton(panelRestore?'▣':'□',togglePanelExpand,'umw-window-button');expand.setAttribute('aria-label',panelRestore?'Restore panel size':'Expand panel');expand.title=panelRestore?'Restore size':'Expand to screen';
    const reset=uiButton('↺',resetPanelLayout,'umw-window-button');reset.setAttribute('aria-label','Reset panel layout');reset.title='Reset size and position';
    close.textContent='−';close.title='Minimize to launcher';
    tools.append(move,expand,reset,close);header.append(brand,tools);
  }
  function panelResizeControl(footer){
    const handle=uiButton('◢',()=>{},'umw-resize-grip');handle.dataset.panelResize='';handle.setAttribute('aria-label','Resize panel');handle.title='Drag to resize. Arrow keys also resize the panel.';
    footer.append(handle);
  }
  window.addEventListener('resize',()=>{if(debugPanelEl)applyPanelRect();});
  window.visualViewport?.addEventListener('resize',()=>{if(debugPanelEl)applyPanelRect();});

  function bindAlertCard(card,entry){
    card.tabIndex=0;card.setAttribute('role','link');card.setAttribute('aria-label','Open '+(entry.itemName||'item')+' listing at '+uiMoney(entry.price));
    const nested=target=>target.closest('button,a,input,select,textarea,summary,details');
    card.addEventListener('click',event=>{if(!nested(event.target))openAlertListing(entry);});
    card.addEventListener('keydown',event=>{if(event.target===card&&(event.key==='Enter'||event.key===' ')){event.preventDefault();openAlertListing(entry);}});
  }

  const LISTING_FOCUS_KEY = 'umw_listing_focus_v713';
  let listingFocusCleanup = null;
  function normalizeListingTarget(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const itemId = Number(entry.itemId || entry.itemRule?.itemId);
    const price = Number(entry.price);
    if (!Number.isSafeInteger(itemId) || itemId < 1 || !Number.isFinite(price) || price <= 0) return null;
    const stat = value => value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
    return { itemId, price, listingIdentity: String(entry.listingIdentity || '').slice(0,100),
      sellerIdentity: String(entry.sellerIdentity || '').slice(0,100), armor:stat(entry.armor), quality:stat(entry.quality),
      itemName:String(entry.itemName || entry.itemRule?.displayName || 'Item').slice(0,100) };
  }
  function openAlertListing(entry) {
    const target = normalizeListingTarget(entry);
    if (!target) return;
    setDebugVisible(false); rebuildDebugPanel(); updateBadge();
    const pending = { ...target, expiresAt:now()+120000 };
    try { sessionStorage.setItem(LISTING_FOCUS_KEY,JSON.stringify(pending)); } catch {}
    const url = buildMarketUrl(target.itemId);
    if (location.href === url) startListingFocus(pending);
    else location.href = url;
  }
  function marketFocusItemId() {
    if (location.pathname !== '/page.php' || new URLSearchParams(location.search).get('sid')?.toLowerCase() !== 'itemmarket') return 0;
    return Number(new URLSearchParams(location.hash.replace(/^#\/?/,'')).get('itemID')) || 0;
  }
  function listingRowEvidence(row) {
    const nodes = [row,...row.querySelectorAll('[data-uid],[data-item-uid],[data-listing-id],[data-listingid]')];
    const ids = new Set();
    for (const node of nodes) for (const name of ['data-uid','data-item-uid','data-listing-id','data-listingid']) {
      const value = node.getAttribute(name); if (value && value !== '0') ids.add(value);
    }
    const priceNode = row.querySelector('[class*="priceAndTotal___"] span:first-child,[class*="price__"],[data-price]');
    const priceText = priceNode?.getAttribute('data-price') || priceNode?.textContent || '';
    const price = Number((priceText.match(/[\d][\d,]*(?:\.\d+)?/) || [''])[0].replace(/,/g,''));
    const text = row.textContent || '';
    function stat(name) {
      const node = row.querySelector('[data-'+name+']');
      const value = node?.getAttribute('data-'+name);
      if (value != null && value !== '' && Number.isFinite(Number(value))) return Number(value);
      // Equipment grids label the numeric value for accessibility; the visible text is only a number.
      for (const property of row.querySelectorAll('[class*="property___"],[aria-label],[title]')) {
        const numeric = property.matches('[class*="property___"]') ? property.querySelector('[class*="value___"]') : property;
        if (!numeric) continue;
        const label = numeric.getAttribute('aria-label') || property.getAttribute('aria-label') || property.getAttribute('title') || '';
        if (!new RegExp('\\b'+name+'\\b','i').test(label)) continue;
        const number = numeric.textContent.trim().match(/^\d+(?:\.\d+)?%?$/);
        if (number) return parseFloat(number[0]);
      }
      const match = text.match(new RegExp('\\b'+name+'\\s*:?\\s*(\\d+(?:\\.\\d+)?)','i'));
      return match ? Number(match[1]) : null;
    }
    const sellers = [...row.querySelectorAll('a[href*="profiles.php"]')].map(a=>{
      try{return new URL(a.href,location.href).searchParams.get('XID');}catch{return null;}
    }).filter(Boolean);
    const itemIds = [...row.querySelectorAll('img[src*="/images/items/"]')].map(img=>Number((img.src.match(/\/images\/items\/(\d+)\//)||[])[1])).filter(Boolean);
    return {ids,price,armor:stat('armor'),quality:stat('quality'),sellers,itemIds};
  }
  function matchListingRow(row,target) {
    const data = listingRowEvidence(row);
    if (data.itemIds.length && !data.itemIds.includes(target.itemId)) return '';
    // A different exposed ID must never fall back to a price-only match.
    if (target.listingIdentity && data.ids.size) return data.ids.has(target.listingIdentity) ? 'exact' : '';
    if (data.price !== target.price) return '';
    // Hidden stats/sellers cannot confirm identity, but should not eliminate a possible price match.
    for (const key of ['armor','quality']) if (target[key] !== null && data[key] !== null && Math.abs(data[key]-target[key])>0.005001) return '';
    if (/^\d+$/.test(target.sellerIdentity) && data.sellers.length && !data.sellers.includes(target.sellerIdentity)) return '';
    return 'possible';
  }
  function startListingFocus(pending) {
    if (!pending) {try{pending=JSON.parse(sessionStorage.getItem(LISTING_FOCUS_KEY)||'null');}catch{}}
    if (listingFocusCleanup) listingFocusCleanup();
    const target=normalizeListingTarget(pending);
    if (!target || !Number.isFinite(pending.expiresAt) || pending.expiresAt<=now()) {
      try{sessionStorage.removeItem(LISTING_FOCUS_KEY);}catch{} return;
    }
    if (marketFocusItemId()!==target.itemId) return;
    let stopped=false,scheduled=false,scrolled=false;
    const marked=new Map();
    const banner=document.createElement('div');banner.id='umw-listing-focus';
    const message=document.createElement('span');message.setAttribute('role','status');
    const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','Dismiss listing highlight');
    banner.append(message,close);document.body.append(banner);
    const setMessage=text=>{if(message.textContent!==text)message.textContent=text;};
    const cleanup=()=>{
      stopped=true;observer.disconnect();clearTimeout(timer);banner.remove();
      for(const row of marked.keys()){row.classList.remove('umw-listing-exact','umw-listing-possible');}
      marked.clear();try{sessionStorage.removeItem(LISTING_FOCUS_KEY);}catch{}
      if(listingFocusCleanup===cleanup)listingFocusCleanup=null;
    };
    const inspect=()=>{
      scheduled=false;if(stopped)return;
      if(marketFocusItemId()!==target.itemId){cleanup();return;}
      const candidates=[...document.querySelectorAll('#item-market-root [class*="sellerList___"] > li,#item-market-root [class*="itemList___"] > li,#item-market-root [class*="itemTile___"]')];
      // Prefer an individual tile over its containing list entry; never outline both.
      const rows=candidates.filter(row=>!candidates.some(other=>other!==row&&row.contains(other)));
      const matches=rows.filter(row=>row.getClientRects().length).map(row=>({row,type:matchListingRow(row,target)})).filter(entry=>entry.type);
      const exact=matches.filter(entry=>entry.type==='exact');
      const selected=exact.length?exact:matches;
      const selectedRows=new Set(selected.map(entry=>entry.row));
      for(const row of marked.keys())if(!selectedRows.has(row)){row.classList.remove('umw-listing-exact','umw-listing-possible');marked.delete(row);}
      for(const {row,type}of selected){if(marked.get(row)!==type){row.classList.remove('umw-listing-exact','umw-listing-possible');row.classList.add('umw-listing-'+type);marked.set(row,type);}}
      if(exact.length)setMessage('Alert listing found · '+uiMoney(target.price)+' at alert time. Check its current price.');
      else if(selected.length)setMessage(selected.length+' possible match'+(selected.length===1?'':'es')+' · '+uiMoney(target.price)+'. Identity or some details are hidden; check the listing.');
      else setMessage(rows.length?'Looking for '+target.itemName+' · '+uiMoney(target.price)+'. It may have sold or be on another page.':'Waiting for market cards or seller rows to load.');
      if(selected.length&&!scrolled){scrolled=true;selected[0].row.scrollIntoView({block:'center',behavior:'auto'});}
    };
    const observer=new MutationObserver(records=>{
      if(records.every(record=>banner.contains(record.target)||record.target===banner))return;
      if(!scheduled){scheduled=true;requestAnimationFrame(inspect);}
    });
    observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['data-uid','data-item-uid','data-listing-id','data-listingid','data-price','data-armor','data-quality','aria-label','title','src']});
    const timer=setTimeout(()=>{stopped=true;observer.disconnect();const found=marked.size;for(const row of marked.keys())row.classList.remove('umw-listing-exact','umw-listing-possible');marked.clear();setMessage(found?'Highlight expired. Reopen the alert to find the listing again.':'Listing not found in the loaded rows. It may have sold, changed, or be on another page.');},60000);
    close.onclick=cleanup;listingFocusCleanup=cleanup;inspect();
  }


  const FEATURE_KEYS = Object.freeze({ groups: 'umw_groups_v710', snoozes: 'umw_snoozes_v710', prices: 'umw_priceHistory_v710' });
  const PRICE_HISTORY_LIMITS = Object.freeze({ ageMs: 7 * 86400000, bucketMs: 5 * 60000, perItem: 288, total: 5000 });

  function normalizeGroup(value) {
    return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ').slice(0, 40);
  }
  function normalizeFixedPrice(value) {
    if (value === null || value === undefined || String(value).trim() === '') return '';
    const number = Number(value);
    // Invalid imported limits fail closed instead of silently removing a cap.
    return Number.isSafeInteger(number) && number >= 1 ? number : 0;
  }
  function getGroupStates() {
    return getJson(FEATURE_KEYS.groups, []).filter(entry => entry && typeof entry.name === 'string')
      .map(entry => ({ name: normalizeGroup(entry.name), paused: entry.paused === true }));
  }
  function isGroupPaused(name) { return getGroupStates().some(entry => entry.name === normalizeGroup(name) && entry.paused); }
  function setGroupPaused(name, paused) {
    const group = normalizeGroup(name);
    const states = new Map(getGroupStates().map(entry => [entry.name, entry]));
    states.set(group, { name: group, paused: !!paused });
    setJson(FEATURE_KEYS.groups, [...states.values()].slice(-500)); cancelScans(); requestDebugPanelRefresh();
  }
  function isRuleScanning(rule) { return !!rule.enabled && !isGroupPaused(rule.group); }
  function getSnoozeUntil(itemId) {
    const until = Number(getJson(FEATURE_KEYS.snoozes, {})[String(itemId)]);
    return Number.isFinite(until) && until > now() ? until : 0;
  }
  function setItemSnooze(itemId, duration) {
    let until = 0;
    if (duration === 'tomorrow') { const date = new Date(now()); date.setHours(24, 0, 0, 0); until = date.getTime(); }
    else if (Number(duration) > 0) until = now() + Math.min(86400000, Number(duration));
    const entries = getJson(FEATURE_KEYS.snoozes, {});
    for (const key of Object.keys(entries)) if (!Number.isFinite(Number(entries[key])) || Number(entries[key]) <= now()) delete entries[key];
    if (until) entries[String(itemId)] = until; else delete entries[String(itemId)];
    setJson(FEATURE_KEYS.snoozes, entries); requestDebugPanelRefresh();
    return until;
  }
  function estimateRuleDuration(rule) { return Math.max(1, Number(rule.pagesToScan) || 1) * 1250 + 600; }
  function scheduleItemEstimates(watchlist, baseTime, phase) {
    const statuses = loadScanStatusMap(); let offset = 0;
    for (const rule of watchlist) {
      if (!isRuleScanning(rule)) continue;
      const previous = statuses[rule.itemId] || {};
      statuses[rule.itemId] = { ...previous, nextCheckAt: baseTime + offset,
        ...(phase === 'queued' ? { phase: 'queued' } : {}) };
      offset += estimateRuleDuration(rule);
    }
    saveScanStatusMap(statuses);
  }
  function itemFreshness(rule, status = {}) {
    if (!status || typeof status !== 'object') status = {};
    let reason = '';
    if (!storageHealthy) reason = 'Storage unavailable';
    else if (!isEnabled()) reason = 'Watcher paused';
    else if (!rule.enabled) reason = 'Item paused';
    else if (isGroupPaused(rule.group)) reason = 'Group paused';
    else if (!isMembershipActive()) reason = 'Membership inactive';
    else if (!getEffectiveApiKey()) reason = 'API key needed';
    else if (getNumber('umw_api_backoff_v680', 0) > now()) reason = 'API cooling down';
    const success = Number(status.lastSuccessAt || (status.ok ? status.at : 0)) || 0;
    if (reason) return { last: success, next: null, detail: reason };
    if (status.phase === 'scanning') return { last: success, next: null, detail: 'Checking now' };
    const next = Number(status.nextCheckAt) || 0;
    const timing = next > now() ? 'Next check in about ' + Math.max(1, Math.ceil((next - now()) / 1000)) + 's' : 'Waiting for next scan';
    return { last: success, next, detail: status.ok === false ? (status.errorMessage || 'Last check failed') + ' · ' + timing : timing };
  }

  function prunePriceHistory(raw, timestamp = now()) {
    const clean = {}; const all = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clean;
    for (const [itemId, entries] of Object.entries(raw)) {
      if (!/^\d+$/.test(itemId) || !Array.isArray(entries)) continue;
      const valid = entries.filter(point => point && Number.isFinite(point.at) && point.at <= timestamp && point.at >= timestamp - PRICE_HISTORY_LIMITS.ageMs &&
        Number.isFinite(point.low) && point.low > 0 && Number.isFinite(point.high) && point.high >= point.low && Number.isFinite(point.count) && point.count > 0)
        .sort((a,b) => a.at - b.at).slice(-PRICE_HISTORY_LIMITS.perItem);
      for (const point of valid) all.push({ itemId, point: { at: point.at, low: point.low, high: point.high, count: Math.floor(point.count), pages: Math.max(1, Math.min(5, Number(point.pages) || 1)) } });
    }
    for (const { itemId, point } of all.sort((a,b) => a.point.at - b.point.at).slice(-PRICE_HISTORY_LIMITS.total)) (clean[itemId] ||= []).push(point);
    return clean;
  }
  function getItemPriceHistory(itemId) { return prunePriceHistory(getJson(FEATURE_KEYS.prices, {}))[String(itemId)] || []; }
  function recordPriceObservation(itemId, listings, pages) {
    if (!getSettings().priceHistoryEnabled) return;
    const prices = listings.map(extractPrice).filter(price => Number.isFinite(price) && price > 0);
    if (!prices.length) return; // Empty and failed responses never become a zero-price observation.
    const history = prunePriceHistory(getJson(FEATURE_KEYS.prices, {}));
    const points = history[String(itemId)] || [];
    const point = { at: now(), low: Math.min(...prices), high: Math.max(...prices), count: prices.length, pages };
    const last = points[points.length - 1];
    if (last && Math.floor(last.at / PRICE_HISTORY_LIMITS.bucketMs) === Math.floor(point.at / PRICE_HISTORY_LIMITS.bucketMs)) points[points.length - 1] = point;
    else points.push(point);
    history[String(itemId)] = points;
    setJson(FEATURE_KEYS.prices, prunePriceHistory(history));
  }
  function clearLocalPriceHistory() { setJson(FEATURE_KEYS.prices, {}); requestDebugPanelRefresh(); }

  function collectEligibleMatches(result, marketValues, seenMap, settings) {
    if (getSnoozeUntil(result.itemRule.itemId) || !isRuleScanning(result.itemRule)) return [];
    const chosen = []; const fingerprints = new Set();
    for (const listing of result.matches || []) {
      const match = { ...result, listing, fingerprint: makeFingerprint(result.itemRule, listing) };
      if (fingerprints.has(match.fingerprint)) continue;
      const payload = buildAlertPayload(match, marketValues);
      const decision = shouldDispatchAlert(match, payload, seenMap, settings);
      if (!decision.shouldAlert) continue;
      fingerprints.add(match.fingerprint); chosen.push({ match, payload, decision });
      if (!settings.digestEnabled) break;
    }
    return chosen;
  }
  function dispatchItemMatches(result, marketValues, seenMap, settings) {
    const chosen = collectEligibleMatches(result, marketValues, seenMap, settings);
    if (!chosen.length) return 0;
    const first = chosen[0]; let payload = first.payload;
    if (chosen.length > 1) {
      const prices = chosen.map(entry => entry.payload.price);
      const low = Math.min(...prices), high = Math.max(...prices);
      const summaries = chosen.slice(0,5).map(entry => entry.payload.formatted.text);
      payload = { ...first.payload, matchCount: chosen.length, priceHigh: high, summaries, targets: chosen.slice(0,5).map(entry=>normalizeListingTarget(entry.payload)),
        formatted: { ...first.payload.formatted,
          text: chosen.length + ' matching listings · ' + uiMoney(low) + (high !== low ? '–' + uiMoney(high) : '') + ' · Tap to open the first match' } };
    }
    notifyWatchItemHit(first.match, payload);
    recordAlertDispatch(first.match, payload, seenMap, first.decision);
    // Every included match consumes its own cooldown, not just the cheapest one.
    for (const entry of chosen) {
      seenMap[entry.payload.fingerprint] = entry.decision.tsNow;
      seenMap[entry.payload.alertIdentity] = entry.decision.tsNow;
    }
    saveSeenMap(seenMap); return chosen.length;
  }

  function renderGroupToolbar(container, model) {
    let names = [...new Set(model.watchlist.map(rule => normalizeGroup(rule.group)))].sort((a,b) => a.localeCompare(b));
    if (!names.length) return;
    if (designState.groupFilter !== null && !names.includes(designState.groupFilter)) designState.groupFilter = null;
    const row = uiNode('div','umw-group-bar'); const label = uiNode('label','umw-field');
    label.append(uiNode('span','umw-field-label','Watchlist group'));
    const select = uiNode('select'); select.setAttribute('aria-label','Filter watchlist by group');
    const populate = () => {
    const rules=getWatchlist();names=[...new Set(rules.map(rule=>normalizeGroup(rule.group)))].sort((a,b)=>a.localeCompare(b));
    select.replaceChildren();
    const all = uiNode('option','','All items (' + rules.length + ')'); all.value='all';select.append(all);
    for (const [index, name] of names.entries()) {
      const count = rules.filter(rule => normalizeGroup(rule.group) === name).length;
      const option = uiNode('option','',(name || 'Ungrouped') + ' (' + count + ')' + (isGroupPaused(name) ? ' · paused' : ''));
      option.value=String(index); option.selected=designState.groupFilter === name;select.append(option);
    }
    };populate();select.onfocus=populate;
    select.onchange=()=>{designState.groupFilter=select.value==='all'?null:names[Number(select.value)];select.blur();requestDebugPanelRefresh();};
    label.append(select);row.append(label);
    if (designState.groupFilter !== null) {
      const group=designState.groupFilter, paused=isGroupPaused(group);
      row.append(uiButton(paused?'Resume group':'Pause group',()=>{setGroupPaused(group,!paused);uiNotice((group||'Ungrouped')+(paused?' resumed.':' paused. Individual item switches are unchanged.'));}));
    }
    container.append(row);
  }
  function renderSnoozeControl(container, rule) {
    const until=getSnoozeUntil(rule.itemId); const row=uiNode('div','umw-snooze-row');
    const label=uiNode('label','umw-field');label.append(uiNode('span','umw-field-label','Alert snooze'));
    const select=uiNode('select'); select.setAttribute('aria-label','Snooze alerts for '+rule.displayName);
    for(const [value,text]of [['','Choose duration…'],['900000','15 minutes'],['3600000','1 hour'],['tomorrow','Until tomorrow'],['0','Resume alerts now']]){
      const option=uiNode('option','',text);option.value=value;select.append(option);
    }
    select.onchange=()=>{if(select.value==='')return;const end=setItemSnooze(rule.itemId,select.value);select.blur();uiNotice(end?'Alerts snoozed. Scanning and price history continue.':'Alerts resumed.');requestDebugPanelRefresh();};
    label.append(select);row.append(label,uiNode('span','umw-muted',until?'Quiet until '+formatDateTime(until):'Alerts are on. Snoozing does not stop scans.'));container.append(row);
  }
  function renderItemHistory(container, rule) {
    const box=uiNode('section','umw-price-history');box.append(uiHeading('Observed price history','Lowest asking price across the pages scanned, before your filters. These are not completed sales.'));
    const points=getItemPriceHistory(rule.itemId);
    if(!points.length){box.append(uiNode('p','umw-muted',getSettings().priceHistoryEnabled?'No observations yet. History starts after a successful scan with listings.':'History recording is off. Enable it in Settings.'));container.append(box);return;}
    const low=Math.min(...points.map(p=>p.low)),high=Math.max(...points.map(p=>p.low));
    const latest=points[points.length-1];box.append(uiNode('p','umw-history-summary','Latest '+uiMoney(latest.low)+' · Observed low '+uiMoney(low)+' · '+points.length+' samples'));
    const width=560,height=150,padding=12,first=points[0].at,last=latest.at;
    const ns='http://www.w3.org/2000/svg';const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 '+width+' '+height);svg.setAttribute('role','img');svg.setAttribute('aria-label','Lowest observed asking prices from '+uiMoney(low)+' to '+uiMoney(high));
    const coordinates=points.map(p=>[(last===first?width/2:padding+(p.at-first)/(last-first)*(width-padding*2)),high===low?height/2:height-padding-(p.low-low)/(high-low)*(height-padding*2)]);
    const line=document.createElementNS(ns,'polyline');line.setAttribute('points',coordinates.map(p=>p.join(',')).join(' '));line.setAttribute('fill','none');line.setAttribute('stroke','currentColor');line.setAttribute('stroke-width','2');svg.append(line);
    for(const [x,y]of [coordinates[0],coordinates[coordinates.length-1]]){const dot=document.createElementNS(ns,'circle');dot.setAttribute('cx',x);dot.setAttribute('cy',y);dot.setAttribute('r','3');dot.setAttribute('fill','currentColor');svg.append(dot);}box.append(svg);
    const range=uiNode('div','umw-item-bottom');range.append(uiNode('span','umw-muted',formatDateTime(first)),uiNode('span','umw-muted',formatDateTime(last)));box.append(range);
    const details=uiNode('details','umw-history-samples');details.dataset.detailKey='prices:'+rule.itemId;details.append(uiNode('summary','','Recent observations'));
    const table=uiNode('table');const head=uiNode('tr');for(const title of ['Checked','Lowest ask','Listings'])head.append(uiNode('th','',title));table.append(head);
    for(const point of points.slice(-12).reverse()){const row=uiNode('tr');for(const text of [fmtTime(point.at),uiMoney(point.low),String(point.count)])row.append(uiNode('td','',text));table.append(row);}details.append(table);box.append(details);
    box.append(uiNode('small','umw-muted','Stored on this browser: up to 7 days, 288 samples per item, and 5,000 samples overall. Latest snapshot in each 5-minute bucket.'));
    container.append(box);
  }

  const designState = { tab: 'watchlist', edit: null, history: null, groupFilter: null, search: '', notice: '', noticeError: false, busy: false, tools: false, importText: '', importMode: 'merge' };
  function uiNode(tag, className = '', text = '') {
    const node = document.createElement(tag); node.className = className;
    if (text !== '') node.textContent = text;
    return node;
  }
  function uiButton(text, action, kind = '') {
    const button = uiNode('button', 'umw-btn ' + kind, text); button.type = 'button';
    button.addEventListener('click', async () => {
      try { await action(); } catch (error) { uiNotice(cleanMessage(error.message || error), true); }
    }); return button;
  }
  function uiNotice(text, error = false) {
    designState.notice = text; designState.noticeError = error;
    const region = debugPanelEl?.querySelector('[data-notice]');
    if (region) { region.textContent = text; region.hidden = !text; region.dataset.error = String(error); }
  }
  function uiField(label, value, onChange, options = {}) {
    const wrap = uiNode('label', 'umw-field'); wrap.append(uiNode('span', 'umw-field-label', label));
    const input = uiNode('input'); input.type = options.type || 'number'; input.value = value ?? '';
    input.setAttribute('aria-label', label);
    for (const key of ['min','max','step','placeholder']) if (options[key] !== undefined) input[key] = options[key];
    input.addEventListener('change', () => {
      if (!input.checkValidity()) { input.reportValidity(); return; }
      try { onChange(input.value); } catch (error) { uiNotice(error.message, true); }
    });
    wrap.append(input);
    if (options.help) wrap.append(uiNode('small', 'umw-muted', options.help));
    return wrap;
  }
  function uiSwitch(label, checked, action, help = '') {
    const row = uiNode('label', 'umw-switch-row');
    const copy = uiNode('span'); copy.append(uiNode('strong', '', label));
    if (help) copy.append(uiNode('small', 'umw-muted', help));
    const input = uiNode('input', 'umw-switch'); input.type = 'checkbox'; input.checked = checked;
    input.setAttribute('aria-label', label); input.addEventListener('change', () => action(input.checked));
    row.append(copy, input); return row;
  }
  function uiHeading(title, subtitle = '') {
    const div = uiNode('div', 'umw-section-heading'); div.append(uiNode('h2', '', title));
    if (subtitle) div.append(uiNode('p', 'umw-muted', subtitle)); return div;
  }
  function uiEmpty(title, text, action) {
    const box = uiNode('div', 'umw-empty'); box.append(uiNode('span', 'umw-empty-symbol', '⌕'), uiNode('h3', '', title), uiNode('p', 'umw-muted', text));
    if (action) box.append(action); return box;
  }
  function uiUpdateRule(id, patch) {
    const list = getWatchlist(); const index = list.findIndex(rule => rule.id === id);
    if (index < 0) return;
    list[index] = { ...list[index], ...patch }; saveWatchlist(list); uiNotice('Filters saved.');
  }
  function uiUpdateSetting(patch) { saveSettings({ ...getSettings(), ...patch }); uiNotice('Settings saved.'); }
  function uiMoney(value) { return Number(value) > 0 ? '$' + Number(value).toLocaleString() : 'Unavailable'; }
  function uiStatus() {
    if (!storageHealthy) return { label: 'Storage unavailable', detail: 'Scanning is paused until browser storage is available.', tone: 'warning' };
    if (!isEnabled()) return { label: 'Watcher paused', detail: 'Your filters are saved. Resume whenever you\u2019re ready.', tone: 'idle' };
    if (!isMembershipActive()) return { label: 'Connect your account', detail: 'Add your API key in Settings to verify membership and start watching.', tone: 'warning' };
    if (!getEffectiveApiKey()) return { label: 'API key needed', detail: 'Add your saved scanning key in Settings.', tone: 'warning' };
    const until = getNumber('umw_api_backoff_v680', 0);
    if (until > now()) return { label: 'Taking a short break', detail: 'The API asked us to wait. Scanning will retry automatically.', tone: 'warning' };
    if (!getWatchlist().some(isRuleScanning)) return { label: 'Ready when you are', detail: 'Add an item, enable an item, or resume a paused group to begin.', tone: 'idle' };
    return { label: isRunningLoop ? 'Scanning your watchlist' : 'Watching the market', detail: isLeader ? 'New matches appear in Alerts. Purchases stay in your hands.' : 'Another open tab is scanning for you.', tone: 'active' };
  }

  function renderDebugPanelMinimized() { setDebugPanelMinimized(false); refreshDebugPanel(true); }
  function refreshDebugPanel(force = false) {
    if (!isDebugVisible()) return;
    ensureDebugPanel();
    if (designState.busy) return;
    const focused = debugPanelEl.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && document.activeElement.type !== 'checkbox';
    if (focused || uiState.dragging) return;
    const previousFocusLabel = debugPanelEl.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null;
    const scroll = debugPanelEl.querySelector('.umw-content')?.scrollTop || 0;
    const model = buildDebugPanelViewModel();
    const expandedDetails = new Set([...debugPanelEl.querySelectorAll('details[open]')].map(el=>el.dataset.detailKey || el.className + ':' + el.querySelector('summary')?.textContent));
    debugPanelEl.replaceChildren();
    const header = uiNode('header', 'umw-header');
    const brand = uiNode('div', 'umw-brand'); brand.append(uiNode('span', 'umw-brandmark', 'MW'));
    const title = uiNode('div'); title.append(uiNode('h1', '', 'Market Watcher'), uiNode('span', 'umw-muted', 'Drag the header · Resize the corner'));
    brand.append(title);
    const close = uiButton('×', () => { setDebugVisible(false); rebuildDebugPanel(); updateBadge(); badgeEl?.focus(); }, 'umw-icon-button');
    close.setAttribute('aria-label', 'Close Market Watcher'); close.dataset.close = '';
    panelWindowControls(header,brand,close); debugPanelEl.append(header);

    const overview = uiNode('div', 'umw-overview'); const state = uiStatus(); overview.dataset.tone = state.tone;
    const statusCopy = uiNode('div'); const statusLine = uiNode('div', 'umw-status-line');
    statusLine.append(uiNode('span', 'umw-dot'), uiNode('strong', '', state.label));
    statusCopy.append(statusLine, uiNode('p', 'umw-muted', state.detail));
    const pause = uiButton(isEnabled() ? 'Pause watcher' : 'Resume watcher', () => { unlockAudioContext(); setWatcherEnabledState(!isEnabled()); }, isEnabled() ? '' : 'umw-primary');
    overview.append(statusCopy, pause); debugPanelEl.append(overview);

    const nav = uiNode('nav', 'umw-tabs'); nav.setAttribute('aria-label', 'Watcher views');
    for (const [key, label, count] of [['watchlist','Watchlist',model.watchlist.length],['alerts','Alerts',model.popupHistory.length],['rw','RW Scout',null],['settings','Settings',null]]) {
      const button = uiButton(label, () => { designState.tab = key; designState.notice = ''; requestDebugPanelRefresh(true); });
      button.setAttribute('aria-label', label); button.dataset.selected = String(designState.tab === key); button.setAttribute('aria-current', designState.tab === key ? 'page' : 'false');
      if (count !== null) button.append(uiNode('span', 'umw-count', String(count))); nav.append(button);
    }
    debugPanelEl.append(nav);
    const content = uiNode('div', 'umw-content'); content.dataset.view = designState.tab;
    const notice = uiNode('div', 'umw-notice', designState.notice); notice.dataset.notice = ''; notice.hidden = !designState.notice;
    notice.dataset.error = String(designState.noticeError); notice.setAttribute('role', 'status'); content.append(notice);
    if (designState.tab === 'watchlist') renderWatchlistView(content, model);
    else if (designState.tab === 'alerts') renderAlertsView(content, model);
    else if (designState.tab === 'rw') getRwModule().mountInto(content);
    else renderSettingsView(content, model);
    for (const detail of content.querySelectorAll('details')) if (!detail.closest('#umw-rw-scout')) detail.open = expandedDetails.has(detail.dataset.detailKey || detail.className + ':' + detail.querySelector('summary')?.textContent);
    debugPanelEl.append(content);
    const footer = uiNode('footer', 'umw-footer'); footer.append(uiNode('span', '', 'Last scan · ' + formatElapsedSince(model.lastScanAt)), uiNode('span', '', 'v' + getScriptVersion()));
    panelResizeControl(footer);
    debugPanelEl.append(footer); applyPanelRect(); content.scrollTop = force ? 0 : scroll;
    if (previousFocusLabel) [...debugPanelEl.querySelectorAll('[aria-label]')].find(node => node.getAttribute('aria-label') === previousFocusLabel)?.focus({preventScroll:true});
  }

  function renderWatchlistView(container, model) {
    const stats = uiNode('div', 'umw-metrics');
    for (const [label, value, note] of [
      ['ACTIVE ITEMS', model.watchlist.filter(isRuleScanning).length, 'of ' + model.watchlist.length + ' saved'],
      ['SCAN INTERVAL', Math.round(model.settings.pollMs / 1000) + 's', 'between completed scans'],
      ['RECENT MATCHES', model.popupHistory.length, 'in the last 3 hours']]) {
      const tile = uiNode('div', 'umw-metric'); tile.append(uiNode('span', 'umw-eyebrow', label), uiNode('strong', '', String(value)), uiNode('small','umw-muted',note)); stats.append(tile);
    }
    container.append(stats);
    if (!model.membership.active) {
      const onboarding = uiNode('div','umw-callout'); onboarding.append(uiNode('div','', 'Build your watchlist now. Connect your account when you\u2019re ready to scan.'), uiButton('Connect account',()=>{designState.tab='settings';requestDebugPanelRefresh(true);},'umw-primary'));
      container.append(onboarding);
    }
    const bar = uiNode('div','umw-toolbar'); bar.append(uiHeading('Your watchlist', 'Choose an item, set your limits, and let the watcher check for matches.'));
    bar.append(uiButton(designState.tools ? 'Close tools' : 'Presets & import',()=>{designState.tools=!designState.tools;requestDebugPanelRefresh(true);}));container.append(bar);
    if (designState.tools) renderWatchlistTools(container, model);
    renderGroupToolbar(container, model);
    const add = uiNode('div','umw-add'); const search = uiNode('input'); search.type='search'; search.placeholder='Add an item by name or ID…'; search.setAttribute('aria-label','Search item catalog'); search.value=designState.search;
    const results = uiNode('div','umw-search-results'); results.setAttribute('aria-live','polite');
    const drawResults = () => {
      results.replaceChildren(); if(!designState.search.trim()) return;
      const found=searchCatalog(designState.search,new Set(getWatchlist().map(r=>r.itemId)));
      if(!found.length) results.append(uiNode('p','umw-muted','No new items found. Try a name or item ID.'));
      for(const item of found) {
        const row=uiButton('',()=>{
          const list=getWatchlist(); if(!list.some(r=>r.itemId===item.itemId)) list.push(sanitizeImportedWatchRule({...item,id:'watch_'+item.itemId+'_'+Date.now(),group:designState.groupFilter||''}));
          saveWatchlist(list);designState.search='';designState.edit=item.itemId;uiNotice(item.displayName+' added. Adjust its filters below.');requestDebugPanelRefresh(true);
        },'umw-search-result');
        row.append(uiNode('span','',item.displayName),uiNode('span','umw-muted','#'+item.itemId+'  + Add'));results.append(row);
      }
    };
    search.oninput=()=>{designState.search=search.value;drawResults();};
    search.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();results.querySelector('button')?.click();search.blur();}};
    add.append(search,results);container.append(add);drawResults();
    if(designState.removed){
      const undo=uiNode('div','umw-tool-row');undo.append(uiNode('span','umw-muted',designState.removed.displayName+' removed.'),uiButton('Undo removal',()=>{
        const list=getWatchlist();if(!list.some(r=>r.itemId===designState.removed.itemId))list.push(designState.removed);
        saveWatchlist(list);designState.removed=null;uiNotice('Item restored.');requestDebugPanelRefresh();
      }));container.append(undo);
    }
    if(!model.watchlist.length) {container.append(uiEmpty('Your next find starts here','Search above to add your first item. You can set a price limit, minimum armor, and minimum quality.'));return;}
    const cards=uiNode('div','umw-item-list');
    for(const rule of model.watchlist.filter(rule => designState.groupFilter === null || normalizeGroup(rule.group) === designState.groupFilter)) renderItemCard(cards,rule,model);
    container.append(cards);
  }

  function renderItemCard(container,rule,model) {
    const card=uiNode('article','umw-item');card.dataset.expanded=String(designState.edit===rule.itemId||designState.history===rule.itemId);card.dataset.enabled=String(isRuleScanning(rule));
    const top=uiNode('div','umw-item-top');
    const identity=uiNode('div','umw-item-identity');const monogram=uiNode('span','umw-item-icon',rule.displayName.slice(0,2).toUpperCase());
    const names=uiNode('div');names.append(uiNode('h3','',rule.displayName),uiNode('span','umw-muted','ITEM #'+rule.itemId));identity.append(monogram,names);
    const toggle=uiSwitch('Watch '+rule.displayName,rule.enabled,checked=>uiUpdateRule(rule.id,{enabled:checked}));toggle.classList.add('umw-item-toggle');
    top.append(identity,toggle);card.append(top);
    const chips=uiNode('div','umw-chips');
    chips.append(uiNode('span','umw-chip',rule.useMV ? 'Price ≤ '+Math.round(rule.maxMultiplier*100)+'% of market value' : rule.maxPrice !== '' ? 'Fixed price limit' : 'No price limit'));
    if(rule.maxPrice !== '') chips.append(uiNode('span','umw-chip',rule.maxPrice > 0 ? 'Price ≤ '+uiMoney(rule.maxPrice) : 'Invalid price cap · edit required'));
    if(rule.group) chips.append(uiNode('span','umw-chip',rule.group+(isGroupPaused(rule.group)?' · paused':'')));
    if(getSnoozeUntil(rule.itemId)) chips.append(uiNode('span','umw-chip','Alerts snoozed'));
    if(rule.minArmor!=='')chips.append(uiNode('span','umw-chip','Armor ≥ '+rule.minArmor));
    if(rule.minQuality!=='')chips.append(uiNode('span','umw-chip','Quality ≥ '+rule.minQuality));
    card.append(chips);
    const bottom=uiNode('div','umw-item-bottom');const status=model.scanStatusMap[rule.itemId];
    const freshness = itemFreshness(rule, status);
    const fresh = uiNode('div','umw-freshness');
    fresh.append(uiNode('span','umw-muted',freshness.last ? 'Last successful check: '+formatElapsedSince(freshness.last) : 'No successful check yet'),uiNode('span','umw-muted',freshness.detail));
    if(status?.lastAttemptAt && status.ok === false) fresh.append(uiNode('span','umw-muted','Last attempt: '+formatElapsedSince(status.lastAttemptAt)));
    bottom.append(fresh);
    const edit=uiButton(designState.edit===rule.itemId?'Done':'Edit filters',()=>{designState.edit=designState.edit===rule.itemId?null:rule.itemId;requestDebugPanelRefresh();},'umw-text-button');
    edit.setAttribute('aria-expanded',String(designState.edit===rule.itemId));edit.setAttribute('aria-label',(designState.edit===rule.itemId?'Finish editing ':'Edit filters for ')+rule.displayName);bottom.append(edit);card.append(bottom);
    const historyButton = uiButton(designState.history === rule.itemId ? 'Hide price history' : 'Price history',()=>{designState.history=designState.history===rule.itemId?null:rule.itemId;requestDebugPanelRefresh();},'umw-text-button');
    historyButton.setAttribute('aria-label','Price history for '+rule.displayName);card.append(historyButton);
    if(designState.history===rule.itemId)renderItemHistory(card,rule);
    if(designState.edit===rule.itemId) {
      const form=uiNode('div','umw-rule-editor');
      form.append(uiSwitch('Limit price by market value',rule.useMV,checked=>uiUpdateRule(rule.id,{useMV:checked}),'The daily market value is a reference price, not a guaranteed resale price.'));
      form.append(uiNode('p','umw-muted','All enabled filters must pass. Use either price limit alone, or both together.'));
      const grid=uiNode('div','umw-form-grid');
      grid.append(uiField('Fixed maximum price ($)',rule.maxPrice,value=>uiUpdateRule(rule.id,{maxPrice:value}),{min:1,max:Number.MAX_SAFE_INTEGER,step:1,placeholder:'No fixed limit',help:'Blank turns off this cap. A matching listing must also pass your other filters.'}));
      grid.append(uiField('Item group',rule.group,value=>uiUpdateRule(rule.id,{group:normalizeGroup(value)}),{type:'text',placeholder:'Ungrouped',help:'Type a group name, such as Armor or Trading. Matching names share a group.'}));
      if(rule.useMV)grid.append(uiField('Maximum price (% of market value)',Math.round(rule.maxMultiplier*10000)/100,value=>uiUpdateRule(rule.id,{maxMultiplier:Number(value)/100}),{min:1,max:10000,step:.1,help:'100% = market value. 90% = 10% below it.'}));
      grid.append(uiField('Minimum armor',rule.minArmor,value=>uiUpdateRule(rule.id,{minArmor:value}),{min:0,max:10000,step:.01,placeholder:'No minimum'}),uiField('Minimum quality',rule.minQuality,value=>uiUpdateRule(rule.id,{minQuality:value}),{min:0,max:10000,step:.01,placeholder:'No minimum'}),uiField('Pages to scan',rule.pagesToScan,value=>uiUpdateRule(rule.id,{pagesToScan:Number(value)}),{min:1,max:5,step:1,help:'Up to 100 listings per page. More pages take longer.'}));form.append(grid);
      renderSnoozeControl(form,rule);
      const actions=uiNode('div','umw-editor-footer');actions.append(uiNode('span','umw-muted','Daily market value: '+uiMoney(model.marketValues[rule.itemId])));
      actions.append(uiButton('Remove item',()=>{
        const previous=getWatchlist();saveWatchlist(previous.filter(r=>r.id!==rule.id));designState.edit=null;
        designState.removed=rule;uiNotice(rule.displayName+' removed.');requestDebugPanelRefresh();
      },'umw-danger'));form.append(actions);card.append(form);
    }
    container.append(card);
    if(designState.removed){ /* Undo lives at the end of the list through the notice toolbar. */ }
  }

  function renderWatchlistTools(container,model) {
    const box=uiNode('section','umw-tools');box.append(uiHeading('Saved setups','Save a watchlist as a preset, or transfer filters between devices.'));
    const row=uiNode('div','umw-tool-row');const name=uiNode('input');name.type='text';name.placeholder='New preset name';name.setAttribute('aria-label','New preset name');
    row.append(name,uiButton('Save preset',()=>{if(getPresetEntries().some(p=>p.name===sanitizePresetName(name.value)))throw Error('That name is already used. Choose a different name.');saveCurrentWatchlistAsPreset(name.value);uiNotice('Preset saved.');requestDebugPanelRefresh();}));box.append(row);
    if(model.presets.length){
      const row=uiNode('div','umw-tool-row');const select=uiNode('select');select.setAttribute('aria-label','Saved presets');
      for(const preset of model.presets){const option=uiNode('option','',preset.name+' · '+preset.watchlist.length+' items');option.value=preset.name;select.append(option);}
      row.append(select,uiButton('Merge',()=>{loadPresetIntoWatchlist(select.value,'merge');uiNotice('Preset merged into watchlist.');}),uiButton('Replace',()=>{if(window.confirm('Replace your watchlist with this preset?')){loadPresetIntoWatchlist(select.value);uiNotice('Preset loaded.');}}),uiButton('Delete',()=>{if(window.confirm('Delete this saved preset?')){deletePreset(select.value);uiNotice('Preset deleted.');}},'umw-danger'));box.append(row);
    }
    const transfers=uiNode('div','umw-tool-row');
    transfers.append(uiButton('Export filters',()=>{triggerTextDownload('market-watcher-filters.json',JSON.stringify(buildWatchlistExportPayload(),null,2));uiNotice('Filters exported. API keys are not included.');}));
    const fileLabel=uiNode('label','umw-btn','Import JSON file');const file=uiNode('input','umw-file');file.type='file';file.accept='.json,application/json';file.setAttribute('aria-label','Import JSON file');
    file.onchange=async()=>{const selected=file.files[0];if(!selected)return;if(selected.size>1000000){uiNotice('Choose a JSON file smaller than 1 MB.',true);return;}designState.importText=await selected.text();requestDebugPanelRefresh();};fileLabel.append(file);transfers.append(fileLabel);box.append(transfers);
    const input=uiNode('textarea');input.placeholder='Or paste exported watchlist JSON here…';input.setAttribute('aria-label','Import watchlist JSON');input.value=designState.importText;input.oninput=()=>designState.importText=input.value;box.append(input);
    const importRow=uiNode('div','umw-tool-row');const mode=uiNode('select');mode.setAttribute('aria-label','Import mode');
    for(const [value,label]of [['merge','Merge with current items'],['replace','Replace current watchlist']]){const option=uiNode('option','',label);option.value=value;option.selected=value===designState.importMode;mode.append(option);}mode.onchange=()=>designState.importMode=mode.value;
    importRow.append(mode,uiButton('Import filters',()=>{
      if(designState.importText.length>1000000)throw Error('Import is too large (1 MB maximum).');
      let parsed;try{parsed=JSON.parse(designState.importText);}catch{throw Error('That is not valid JSON. Paste exported filters or choose a JSON file.');}
      const raw=Array.isArray(parsed)?parsed:parsed?.watchlist||parsed?.filters;
      if(!Array.isArray(raw))throw Error('This file does not contain a watchlist.');
      const cleaned=raw.slice(0,500).map(sanitizeImportedWatchRule).filter(Boolean);if(!cleaned.length)throw Error('No valid items found.');
      if(designState.importMode==='replace'&&!window.confirm('Replace your current watchlist with imported filters?'))return;
      const merged=new Map((designState.importMode==='merge'?getWatchlist():[]).map(r=>[r.itemId,r]));for(const rule of cleaned)merged.set(rule.itemId,rule);
      saveWatchlist([...merged.values()]);designState.importText='';uiNotice('Imported '+cleaned.length+' item filters.');requestDebugPanelRefresh(true);
    },'umw-primary'));box.append(importRow);container.append(box);
  }

  function renderAlertsView(container,model) {
    const bar=uiNode('div','umw-toolbar');bar.append(uiHeading('Recent matches','Tap an alert to open its listing. Expand a digest to choose another match.'));
    if(model.popupHistory.length)bar.append(uiButton('Clear history',()=>{if(window.confirm('Clear recent alert history?'))clearPopupHistory();}));container.append(bar);
    if(!model.popupHistory.length){container.append(uiEmpty('All quiet for now','Matches will appear here when an item meets your filters. Keep the watcher enabled and this browser open.'));return;}
    for(const entry of model.popupHistory){
      const card=uiNode('article','umw-history');bindAlertCard(card,entry);const row=uiNode('div','umw-toolbar');const title=uiNode('div');title.append(uiNode('span','umw-eyebrow',entry.tier==='insane'?'EXCEPTIONAL MATCH':entry.tier==='strong'?'STRONG MATCH':'MARKET MATCH'),uiNode('h3','',entry.itemName||'Item #'+entry.itemId));
      if(Number(entry.matchCount)>1) title.append(uiNode('span','umw-chip',entry.matchCount+' matching listings'));
      row.append(title,uiNode('strong','umw-price',uiMoney(entry.price)+(entry.priceHigh>entry.price?'–'+uiMoney(entry.priceHigh):'')));card.append(row,uiNode('p','umw-muted',entry.text||''));
      if(Array.isArray(entry.summaries)&&entry.summaries.length){const detail=uiNode('details','umw-digest-detail');detail.dataset.detailKey='digest:'+entry.itemId+':'+entry.at;detail.append(uiNode('summary','','Preview '+entry.summaries.length+' of '+entry.matchCount+' matches'));for(const [index,text] of entry.summaries.entries()){detail.append(uiNode('p','umw-muted',text));if(entry.targets?.[index])detail.append(uiButton('Find listing '+(index+1)+' ↗',()=>openAlertListing(entry.targets[index]),'umw-text-button'));}card.append(detail);}
      const foot=uiNode('div','umw-item-bottom');foot.append(uiNode('span','umw-muted',formatElapsedSince(entry.at)),uiButton('Find listing on market ↗',()=>openAlertListing(entry),'umw-text-button'));card.append(foot);container.append(card);
    }
  }

  function renderSettingsView(container,model) {
    container.append(uiHeading('Make it work your way','Account access, scan timing, and how you hear about a match.'));
    const account=uiNode('section','umw-settings-card');const line=uiNode('div','umw-toolbar');line.append(uiNode('h3','','Your account'),uiNode('span','umw-chip',model.membership.active?'Membership active':'Not connected'));account.append(line);
    if(model.membership.active)account.append(uiNode('p','umw-muted',(model.membership.playerName||'Player')+' · '+formatMembershipRemaining(Math.max(0,model.membership.expiresAt-now()))+' remaining'));
    else account.append(uiNode('p','umw-muted','Connect your Torn API key to check membership. Initial signup includes a 1-day trial.'));
    const key=uiNode('input');key.type='password';key.autocomplete='off';key.placeholder=getEffectiveApiKey()?'Key saved · enter a new key to replace it':'Enter your 16-character Torn API key';key.setAttribute('aria-label','Torn API key');account.append(key);
    const actions=uiNode('div','umw-tool-row');
    const connect=uiButton('Save key & connect',async()=>{
      const value=key.value.trim();if(!value)throw Error('Enter your Torn API key first.');
      designState.busy=true;connect.disabled=true;connect.textContent='Connecting…';
      try {
        const type=await detectApiKeyType(value);
        if(type==='full'&&!window.confirm('Full-access keys are not needed for market scanning. Continue with this key?'))return;
        const registration=await registerWithServer(value);const status=await checkAuthStatus(registration.playerId);applyMembershipState(status);key.value='';key.blur();
        uiNotice(status.active?'Account connected. Your watcher is ready.':'Key saved. Membership is currently inactive.');
      } finally {designState.busy=false;connect.disabled=false;connect.textContent='Save key & connect';requestDebugPanelRefresh();}
    },'umw-primary');actions.append(connect);
    if(getStoredPlayerId())actions.append(uiButton('Refresh membership',async()=>{const status=await checkAuthStatus(getStoredPlayerId());applyMembershipState(status);uiNotice(status.active?'Membership is active.':'Membership is inactive.');}));
    if(getEffectiveApiKey())actions.append(uiButton('Clear saved key',()=>{if(window.confirm('Clear your API key and membership information from this browser?')){clearStoredMembership();uiNotice('Saved account information cleared.');}},'umw-danger'));
    account.append(actions);
    const note=uiNode('div','umw-security-note');note.append(uiNode('strong','','Connection & privacy'),uiNode('p','',
      (BACKEND_BASE_URL.startsWith('https://')?'Membership uses HTTPS. ':'HTTP compatibility is on. Your key is sent unencrypted to the membership server. ')+
      (privateKeyStorage?'Your saved key uses private userscript-manager storage.':'Your saved key uses Torn page storage, which other page scripts can read.')));
    account.append(note,uiNode('p','umw-muted',MEMBERSHIP_PAYMENT_MESSAGE));container.append(account);

    const timing=uiNode('section','umw-settings-card');timing.append(uiNode('h3','','Scan timing'));const grid=uiNode('div','umw-form-grid');
    grid.append(uiField('Scan interval (seconds)',model.settings.pollMs/1000,v=>uiUpdateSetting({pollMs:Number(v)*1000}),{min:5,max:3600,step:1,help:'Wait after each completed scan. Larger watchlists take longer.'}),uiField('Repeat alert cooldown (minutes)',model.settings.alertCooldownMs/60000,v=>uiUpdateSetting({alertCooldownMs:Number(v)*60000}),{min:0,max:1440,step:.1,help:'0 allows a repeat on every scan. History stays for 3 hours.'}));timing.append(grid,uiNode('p','umw-muted','Requests are paced to leave room for your other tools. Torn\u2019s market data is cached, so more frequent checks may return the same listings.'));container.append(timing);
    const notifications=uiNode('section','umw-settings-card');notifications.append(uiNode('h3','','Match notifications'));
    notifications.append(uiSwitch('Combine matches into digests',model.settings.digestEnabled,checked=>uiUpdateSetting({digestEnabled:checked}),'One notification per item per scan, including all newly eligible matches. Off: one matching listing per item per scan.'));
    notifications.append(uiSwitch('Play a sound',model.settings.soundEnabled,checked=>{unlockAudioContext();uiUpdateSetting({soundEnabled:checked});}),uiSwitch('Vibrate',model.settings.vibrationEnabled,checked=>uiUpdateSetting({vibrationEnabled:checked}),'Available on supported devices.'));
    const audio=uiNode('div','umw-form-grid');audio.append(uiField('Sound volume (%)',model.settings.soundVolume,v=>uiUpdateSetting({soundVolume:Number(v)}),{min:0,max:300,step:5}));
    const soundLabel=uiNode('label','umw-field');soundLabel.append(uiNode('span','umw-field-label','Sound style'));const preset=uiNode('select');preset.setAttribute('aria-label','Sound style');
    for(const value of ['classic','arcade','alarm']){const option=uiNode('option','',value[0].toUpperCase()+value.slice(1));option.value=value;option.selected=value===model.settings.soundPreset;preset.append(option);}preset.onchange=()=>uiUpdateSetting({soundPreset:preset.value});soundLabel.append(preset);audio.append(soundLabel);notifications.append(audio);
    const soundTest=uiButton('Test sound',()=>{if(!getSettings().soundEnabled){uiNotice('Turn on \u201cPlay a sound\u201d to test it.');return;}unlockAudioContext();soundForTier('strong');uiNotice('Sound test played.');});notifications.append(soundTest);
    const permission=getDesktopNotificationPermissionState();notifications.append(uiSwitch('Browser notifications',model.settings.desktopNotificationsEnabled,async checked=>{
      if(checked&&permission!=='granted'){const result=await requestDesktopNotificationPermission();if(result!=='granted'){uiUpdateSetting({desktopNotificationsEnabled:false});uiNotice('Notifications are unavailable or blocked. Check your browser permissions.',true);return;}}
      uiUpdateSetting({desktopNotificationsEnabled:checked});
    },'Permission: '+permission+'. Mobile background delivery depends on your browser.'));container.append(notifications);
    const historySettings=uiNode('section','umw-settings-card');historySettings.append(uiNode('h3','','Local price history'));
    historySettings.append(uiSwitch('Record observed prices',model.settings.priceHistoryEnabled,checked=>uiUpdateSetting({priceHistoryEnabled:checked}),'Stores sampled asking prices on this browser. Snoozed items keep recording; paused items and groups do not.'));
    historySettings.append(uiNode('p','umw-muted','Up to 7 days, 288 samples per item, 5,000 samples total. The latest snapshot in each 5-minute bucket is kept. Older samples roll off first; busy items may show a shorter window.'));
    historySettings.append(uiButton('Clear local price history',()=>{if(window.confirm('Delete all locally recorded price observations? Your filters and alerts will stay.')){clearLocalPriceHistory();uiNotice('Local price history cleared.');}},'umw-danger'));container.append(historySettings);
    const diagnostics=uiNode('details','umw-diagnostics');diagnostics.append(uiNode('summary','','Troubleshooting & diagnostics'));
    for(const [label,value]of [['Version',getScriptVersion()],['Scanning tab',isLeader?'This tab':'Another tab'],['Last scan',formatDateTime(model.lastScanAt)],['Daily values',formatDateTime(model.lastValueFetch)],['Last error',model.lastError.message],['Membership',membershipState.reason||'No reported issue'],['Estimated requests per cycle',model.apiEstimate.requestsPerCycle]]){
      const row=uiNode('div','umw-diagnostic-row');row.append(uiNode('span','umw-muted',label),uiNode('span','',String(value)));diagnostics.append(row);
    }
    container.append(diagnostics);
  }


async function apiFetch(url, revision = scanRevision, guard = null) {
    const operation = apiQueue.then(async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (guard) guard();
        if (revision !== null) assertScan(revision);
        const backoff = getNumber('umw_api_backoff_v680', 0);
        if (now() < backoff) throw new Error('API cooling down; retry on a later scan.');
        await sleep(Math.max(0, getNumber('umw_api_next_v680', 0) - now()));
        if (guard) guard();
        if (revision !== null) assertScan(revision);
        localStore.setItem('umw_api_next_v680', String(now() + 1250));
        try {
          const response = await gmRequestJson('GET', url, null, revision !== null || !!guard);
          if (guard) guard();
          return response;
        } catch (error) {
          if (error.cancelled) throw error;
          if ([1, 2, 10, 13, 16, 18].includes(error.code)) {
            if (revision !== null || guard) { setEnabled(false); setStoredApiKey(''); }
            throw error;
          }
          if ([5, 8].includes(error.code) || error.status === 429) {
            setNumber('umw_api_backoff_v680', now() + 60000);
            throw error;
          }
          if (!error.retryable || attempt === 1) {
            if (error.retryable) setNumber('umw_api_backoff_v680', now() + 30000);
            throw error;
          }
          await sleep(1500 + Math.random() * 500);
        }
      }
    });
    apiQueue = operation.catch(() => {});
    return operation;
  }

  async function fetchAllItemsData() {
    const apiKey = getEffectiveApiKey();
    if (!apiKey) throw new Error('No stored Torn API key. Register your membership first.');
    return apiFetch(`https://api.torn.com/torn/?selections=items&key=${encodeURIComponent(apiKey)}`);
  }

  async function fetchItemMarket(itemId, page = 0) {
    const apiKey = getEffectiveApiKey();
    if (!apiKey) throw new Error('No stored Torn API key. Register your membership first.');
    const offset = Math.max(0, Math.floor(Number(page) || 0)) * 100;
    return apiFetch(`https://api.torn.com/v2/market/${itemId}/itemmarket?limit=100&offset=${offset}&key=${encodeURIComponent(apiKey)}`);
  }

function extractListings(data) {
    const value = data?.itemmarket?.listings ?? data?.listings;
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return Object.values(value);
    if (Array.isArray(data?.itemmarket)) return data.itemmarket;
    throw new Error('Unexpected item market response: listings are missing');
  }

  function deepFindNumericField(obj, targetKey, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 7) return null;

    for (const [key, value] of Object.entries(obj)) {
      if (key.toLowerCase() === targetKey && typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
    }

    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') {
        const found = deepFindNumericField(value, targetKey, depth + 1);
        if (found !== null) return found;
      }
    }

    return null;
  }

  function extractPrice(listing) {
    const direct = Number(
      listing?.price ??
      listing?.cost ??
      listing?.item?.price ??
      listing?.item_details?.price ??
      listing?.itemDetails?.price ??
      NaN
    );

    if (Number.isFinite(direct) && direct > 0) return direct;

    const deep = deepFindNumericField(listing, 'price');
    return Number.isFinite(deep) ? Number(deep) : 0;
  }

function extractArmorRaw(listing) {
    const values = [listing?.item_details?.stats?.armor, listing?.item?.stats?.armor,
      listing?.stats?.armor, listing?.armor, listing?.item?.armor,
      listing?.item_details?.armor, listing?.itemDetails?.armor];
    for (const value of values) {
      if (value === null || value === undefined || value === '' || typeof value === 'boolean') continue;
      const number = Number(value);
      if (Number.isFinite(number) && number >= 0) return number;
    }
    return null;
  }

  function extractArmor(listing) {
    const raw = extractArmorRaw(listing);
    return Number.isFinite(raw) ? Math.floor(raw) : null;
  }

function extractQualityRaw(listing) {
    const values = [listing?.item_details?.stats?.quality, listing?.item?.stats?.quality,
      listing?.stats?.quality, listing?.quality, listing?.item?.quality,
      listing?.item_details?.quality, listing?.itemDetails?.quality];
    for (const value of values) {
      if (value === null || value === undefined || value === '' || typeof value === 'boolean') continue;
      const number = Number(value);
      if (Number.isFinite(number) && number >= 0) return number;
    }
    return null;
  }

  function extractQuality(listing) {
    const raw = extractQualityRaw(listing);
    return Number.isFinite(raw) ? Math.floor(raw) : null;
  }

  function getArmorBracket(rawArmor) {
    if (!Number.isFinite(rawArmor)) return null;

    const floor = Math.floor(rawArmor);
    return {
      min: floor,
      max: floor + 1,
      label: `${floor}x`
    };
  }

  function calculateNetSale(sellPrice) {
    if (!Number.isFinite(sellPrice) || sellPrice <= 0) return null;

    const tax = Math.floor(sellPrice * MARKET_TAX_RATE);
    const netSale = sellPrice - tax;

    return {
      tax,
      netSale
    };
  }

  function estimateArmorCompetitivePrice(targetListing, listings) {
    const targetArmorRaw = extractArmorRaw(targetListing);
    const buyPrice = extractPrice(targetListing);

    if (!Number.isFinite(targetArmorRaw) || !Number.isFinite(buyPrice) || buyPrice <= 0) {
      return null;
    }

    const bracket = getArmorBracket(targetArmorRaw);
    if (!bracket) return null;

    const comps = listings
      .filter(listing => listing !== targetListing)
      .map(listing => {
        const armorRaw = extractArmorRaw(listing);
        const price = extractPrice(listing);
        return {
          listing,
          armorRaw,
          price
        };
      })
      .filter(comp =>
        Number.isFinite(comp.armorRaw) &&
        Number.isFinite(comp.price) &&
        comp.price > 0 &&
        comp.armorRaw >= bracket.min &&
        comp.armorRaw < bracket.max
      )
      .sort((a, b) => a.price - b.price);

    if (comps.length === 0) {
      return null;
    }

    const anchorComp = comps[0];

    if (!anchorComp) {
      return null;
    }

    const sellPrice = Math.max(1, anchorComp.price - COMP_UNDERCUT);
    const sale = calculateNetSale(sellPrice);
    if (!sale) return null;

    const netProfit = sale.netSale - buyPrice;

    return {
      sellPrice,
      tax: sale.tax,
      netSale: sale.netSale,
      netProfit,
      compsCount: comps.length,
      bracketLabel: bracket.label,
      anchorPrice: anchorComp.price,
      usedFallback: true
    };
  }

  async function refreshMarketValuesIfNeeded() {
    const current = getJson(STORAGE_KEYS.marketValues, {});
    const lastFetch = getNumber(STORAGE_KEYS.lastValueFetch, 0);

    if (now() - lastFetch < VALUE_REFRESH_MS && Object.keys(current).length > 0) {
      return current;
    }

    const data = await fetchAllItemsData();
    const next = {};

    if (!data.items || typeof data.items !== 'object') throw new Error('Invalid market values response');
    for (const [id, apiItem] of Object.entries(data.items)) {
      const value = Number(apiItem?.market_value);
      if (Number.isFinite(value) && value > 0) next[id] = value;
      if (apiItem?.name && !ITEM_CATALOG.some(item => item.itemId === Number(id))) {
        ITEM_CATALOG.push({ itemId: Number(id), displayName: apiItem.name, rawName: normalizeCatalogNameToKey(apiItem.name) });
      }
    }
    if (!Object.keys(next).length) throw new Error('No valid market values returned');

    setJson(STORAGE_KEYS.marketValues, next);
    setNumber(STORAGE_KEYS.lastValueFetch, now());
    requestDebugPanelRefresh();
    return next;
  }

  function loadSeenMap() {
    if (runtimeCache.seenMap) return { ...runtimeCache.seenMap };
    const map = getJson(STORAGE_KEYS.seenMap, {});
    runtimeCache.seenMap = { ...(map || {}) };
    return { ...runtimeCache.seenMap };
  }

  function saveSeenMap(map) {
    setJson(STORAGE_KEYS.seenMap, map);
    runtimeCache.seenMap = { ...(map || {}) };
  }

  function pruneSeenMap(map) {
    const cutoff = now() - Math.max(SEEN_TTL_MS, getSettings().alertCooldownMs);
    for (const key of Object.keys(map)) {
      if (!Number.isFinite(Number(map[key])) || map[key] < cutoff) delete map[key];
    }
    return map;
  }

function extractListingIdentity(listing) {
    const candidates = [listing?.listingID, listing?.listingId, listing?.itemmarketid,
      listing?.itemMarketId, listing?.item_details?.uid, listing?.item?.uid,
      listing?.uid, listing?.UID, listing?.uniqueId, listing?.uniqueID, listing?.lotID, listing?.lotId];
    const value = candidates.find(value => value !== null && value !== undefined && String(value).trim() !== '' && String(value) !== '0');
    return value === undefined ? '' : String(value).trim();
  }

  function makeFingerprint(itemRule, listing) {
    const listingIdentity = extractListingIdentity(listing);
    if (listingIdentity) {
      return `${itemRule.itemId}|listing:${listingIdentity}|price:${extractPrice(listing)}`;
    }

    const sellerIdentity = String(
      listing?.sellerID ??
      listing?.sellerId ??
      listing?.ownerID ??
      listing?.ownerId ??
      listing?.userID ??
      listing?.userId ??
      'noseller'
    ).trim();

    return `${itemRule.itemId}|${extractPrice(listing)}|${extractArmorRaw(listing) ?? 'noa'}|${extractQualityRaw(listing) ?? 'noq'}|${sellerIdentity}`;
  }

  function buildPageVerificationSignature(listings) {
    const sample = (Array.isArray(listings) ? listings : []).map(listing => {
      const id = extractListingIdentity(listing) || 'na';
      const price = extractPrice(listing) || 'na';
      const armor = extractArmorRaw(listing);
      const quality = extractQualityRaw(listing);
      return `${id}:${price}:${Number.isFinite(armor) ? armor.toFixed(2) : 'na'}:${Number.isFinite(quality) ? quality.toFixed(2) : 'na'}`;
    });

    return sample.join('|') || 'empty';
  }

  function buildPageVerificationSummary(pageDetails) {
    const details = Array.isArray(pageDetails) ? pageDetails : [];
    if (!details.length) {
      return {
        duplicatePageData: false,
        uniquePageSignatures: 0
      };
    }

    const signatures = details.map(detail => String(detail?.signature || 'empty'));
    return {
      duplicatePageData: new Set(signatures).size < signatures.length,
      uniquePageSignatures: new Set(signatures).size
    };
  }


  function listingMatchesRule(itemRule, listing, marketValues) {
    const price = extractPrice(listing);
    if (!Number.isFinite(price) || price <= 0) return false;
    const fixed = normalizeFixedPrice(itemRule.maxPrice);
    if (fixed !== '' && (fixed <= 0 || price > fixed)) return false;

    const rawMinArmor = String(itemRule.minArmor ?? '').trim();
    if (rawMinArmor) {
      const minArmor = Number(rawMinArmor);
      if (!Number.isFinite(minArmor) || minArmor < 0) return false;
      const actualArmor = extractArmorRaw(listing);

      if (!Number.isFinite(actualArmor)) return false;
      if (actualArmor < minArmor) return false;
    }

    const rawMinQuality = String(itemRule.minQuality ?? '').trim();
    if (rawMinQuality) {
      const minQuality = Number(rawMinQuality);
      if (!Number.isFinite(minQuality) || minQuality < 0) return false;
      const actualQuality = extractQualityRaw(listing);

      if (!Number.isFinite(actualQuality)) return false;
      if (actualQuality < minQuality) return false;
    }

    if (itemRule.useMV) {
      const mv = Number(marketValues[itemRule.itemId] || 0);
      if (!Number.isFinite(mv) || mv <= 0) return false;

      const maxMultiplier = Number(itemRule.maxMultiplier || 1.10);
      if (price > mv * maxMultiplier) return false;
    }

    return true;
  }

  function formatMatchText(match, marketValues) {
    const { itemRule, listing, listings } = match;

    const buyPrice = extractPrice(listing);
    const armorRaw = extractArmorRaw(listing);
    const mv = Number(marketValues[itemRule.itemId] || 0);
    const velocityInfo = getVelocityLabel(itemRule.itemId);

    let diffPct = null;
    if (itemRule.useMV && mv > 0) {
      diffPct = ((buyPrice - mv) / mv) * 100;
    }

    const parts = [
      `${itemRule.displayName}`,
      `$${buyPrice.toLocaleString()}`
    ];

    if (Number.isFinite(armorRaw)) {
      parts.push(`A${armorRaw.toFixed(2)}`);
    }

    const qualityRaw = extractQualityRaw(listing);
    if (Number.isFinite(qualityRaw)) {
      parts.push(`Q${qualityRaw.toFixed(2)}`);
    }

    const armorEstimate = estimateArmorCompetitivePrice(listing, listings);

    if (armorEstimate) {
      parts.push(`Lowest ask ~$${armorEstimate.sellPrice.toLocaleString()}`);
      parts.push(`Net ~$${armorEstimate.netProfit.toLocaleString()}`);
      parts.push(armorEstimate.bracketLabel);

      if (armorEstimate.usedFallback) {
        parts.push('rough estimate; not a sale forecast');
      }
    } else if (diffPct !== null) {
      parts.push(`${diffPct.toFixed(1)}%`);
    }

    if (velocityInfo && velocityInfo.samples >= 3) {
      parts.push(`Listing changes: ${velocityInfo.label} (${velocityInfo.pct}% score)`);
    }

    return {
      text: parts.join(' | '),
      diffPct,
      tier: getTier(diffPct ?? 0, !!itemRule.useMV)
    };
  }

  async function scanWatchItem(itemRule, marketValues) {
    const revision = scanRevision;
    const pagesToScan = Math.min(5, Math.max(1, Math.floor(Number(itemRule.pagesToScan) || 1)));
    let listings = [];
    let lastPageHitCount = 0;
    let actualPagesScanned = 0;
    const pageDetails = [];

    for (let page = 0; page < pagesToScan; page++) {
      assertScan(revision);
      const data = await fetchItemMarket(itemRule.itemId, page);
      assertScan(revision);

      const rawListings = extractListings(data);
      const pageListings = rawListings.filter(l => extractPrice(l) > 0);

      actualPagesScanned += 1;
      lastPageHitCount = pageListings.length;
      listings.push(...pageListings);

      pageDetails.push({
        page: page + 1,
        count: pageListings.length,
        signature: buildPageVerificationSignature(pageListings)
      });

      if (rawListings.length < 100 || data?._metadata?.links?.next === null) break;
    }

    const ids = new Set();
    listings = listings.filter(listing => {
      const id = extractListingIdentity(listing);
      if (!id) return true;
      if (ids.has(id)) return false;
      ids.add(id); return true;
    }).sort((a, b) => extractPrice(a) - extractPrice(b));

    const signature = buildVelocitySignature(listings);
    const velocity = updateVelocityForItem(itemRule.itemId, signature);
    const pageVerification = buildPageVerificationSummary(pageDetails);

    const matches = listings.filter(listing => listingMatchesRule(itemRule, listing, marketValues));
    for (const listing of matches) {
      if (listing) {
        const matchedSignature = buildVelocitySignature(listings, listing);

        return {
          itemRule,
          listing,
          listings,
          matches,
          price: extractPrice(listing),
          fingerprint: makeFingerprint(itemRule, listing),
          velocity,
          matchedSignature,
          pagesScanned: actualPagesScanned,
          pagesRequested: pagesToScan,
          lastPageHitCount,
          pageDetails,
          duplicatePageData: pageVerification.duplicatePageData,
          uniquePageSignatures: pageVerification.uniquePageSignatures
        };
      }
    }

    return {
      itemRule,
      listing: null,
      listings,
      velocity,
      matchedSignature: '',
      pagesScanned: actualPagesScanned,
      pagesRequested: pagesToScan,
      lastPageHitCount,
      pageDetails,
      duplicatePageData: pageVerification.duplicatePageData,
      uniquePageSignatures: pageVerification.uniquePageSignatures
    };
  }


  function buildAlertPayload(match, marketValues) {
    const itemRule = match?.itemRule || {};
    const listing = match?.listing || {};
    const formatted = formatMatchText(match, marketValues);
    const url = buildMarketUrl(itemRule.itemId);
    const fingerprint = String(match?.fingerprint || '').trim();
    const listingIdentity = extractListingIdentity(listing);
    const sellerIdentity = String(
      listing?.sellerID ??
      listing?.sellerId ??
      listing?.ownerID ??
      listing?.ownerId ??
      listing?.userID ??
      listing?.userId ??
      'noseller'
    ).trim();
    const price = Number(extractPrice(listing) || 0);
    const armor = extractArmorRaw(listing);
    const quality = extractQualityRaw(listing);
    const alertIdentity = buildAlertIdentity(match);

    return {
      itemRule,
      listing,
      formatted,
      url,
      fingerprint,
      alertIdentity,
      listingIdentity,
      sellerIdentity,
      price,
      armor,
      quality
    };
  }

  function shouldDispatchAlert(match, payload, seenMap, settings) {
    const fingerprint = String(payload?.fingerprint || '').trim();
    const alertIdentity = String(payload?.alertIdentity || '').trim();
    const cooldownMs = Number(settings?.alertCooldownMs || 0);
    const tsNow = now();
    if (getSnoozeUntil(match?.itemRule?.itemId || payload?.itemRule?.itemId)) return { shouldAlert: false, reason: 'snoozed', tsNow };

    const cooldownKeys = [alertIdentity, fingerprint].filter(Boolean);

    for (const key of cooldownKeys) {
      const lastSeenAt = Number(seenMap?.[key] || 0);
      if (lastSeenAt && (tsNow - lastSeenAt) < cooldownMs) {
        return {
          shouldAlert: false,
          reason: 'cooldown',
          tsNow
        };
      }
    }

    if (shouldSuppressPopupAlert(match, payload)) {
      return {
        shouldAlert: false,
        reason: 'recent-popup',
        tsNow
      };
    }

    return {
      shouldAlert: true,
      reason: 'ok',
      tsNow
    };
  }

  function recordAlertDispatch(match, payload, seenMap, decision) {
    const fingerprint = String(payload?.fingerprint || '').trim();
    const alertIdentity = String(payload?.alertIdentity || '').trim();
    const tsNow = Number(decision?.tsNow || now());

    if (fingerprint) {
      seenMap[fingerprint] = tsNow;
    }
    if (alertIdentity) {
      seenMap[alertIdentity] = tsNow;
    }

    addPopupHistoryEntry({
      itemId: payload?.itemRule?.itemId,
      itemName: payload?.itemRule?.displayName,
      text: payload?.formatted?.text,
      tier: payload?.formatted?.tier,
      fingerprint,
      alertIdentity,
      listingIdentity: payload?.listingIdentity,
      sellerIdentity: payload?.sellerIdentity,
      price: payload?.price,
      armor: payload?.armor,
      quality: payload?.quality,
      url: payload?.url,
      matchCount: payload?.matchCount,
      priceHigh: payload?.priceHigh,
      targets: payload?.targets,
      summaries: payload?.summaries
    });

    setLastAlert(`${payload?.itemRule?.displayName || 'Unknown item'} | ${payload?.formatted?.text || ''}`);
  }

  function notifyWatchItemHit(match, payload) {
  const itemRule = payload?.itemRule || match?.itemRule || {};
  const formatted = payload?.formatted || formatMatchText(match, {});
  const url = payload?.url || buildMarketUrl(itemRule.itemId);

  const title = itemRule.displayName + (payload?.matchCount > 1 ? ' · ' + payload.matchCount + ' matches' : '');
  showToast(title, formatted.text, formatted.tier, () => {
    openAlertListing(payload);
  }, 'Open '+itemRule.displayName+' listing on the market');

  showDesktopNotification(title, formatted.text, url, ()=>openAlertListing(payload));
  return true;
}
  function getLeaderInfo() {
    return {
      id: localStore.getItem(LOCK_KEY) || '',
      beat: getNumber(LOCK_HEARTBEAT_KEY, 0)
    };
  }

  function tryBecomeLeader() {
    const { id, beat } = getLeaderInfo();
    const stale = !id || (now() - beat > LOCK_TIMEOUT_MS);

    if (stale || id === TAB_ID) {
      localStore.setItem(LOCK_KEY, TAB_ID);
      isLeader = true;
      setNumber(LOCK_HEARTBEAT_KEY, now());
      return true;
    }

    isLeader = false;
    return false;
  }

  function maintainLeadership() {
    if (pageSuspended || !storageHealthy) return;
    const { id, beat } = getLeaderInfo();
    const stale = !id || (now() - beat > LOCK_TIMEOUT_MS);

    if (id === TAB_ID || stale) {
      localStore.setItem(LOCK_KEY, TAB_ID);
      setNumber(LOCK_HEARTBEAT_KEY, now());

      if (!isLeader) {
        isLeader = true;
        if (isEnabled()) runLoop();
      }
    } else {
      if (isLeader) cancelScans();
      isLeader = false;
    }

    updateBadge();
    requestDebugPanelRefresh();
  }

  function releaseLeadership() {
    cancelScans();
    isLeader = false;
    const { id } = getLeaderInfo();
    if (id === TAB_ID) {
      localStore.setItem(LOCK_KEY, '');
      setNumber(LOCK_HEARTBEAT_KEY, 0);
    }
  }

  async function runLoop() {
    if (navigator.locks?.request) {
      return navigator.locks.request('umw-scan-v680', { ifAvailable: true }, async lock => {
        if (lock) await scanCycle();
      });
    }
    return scanCycle();
  }

  async function scanCycle() {
    if (!canScan() || isRunningLoop) return;

    isRunningLoop = true;
    const revision = scanRevision;
    invalidateRuntimeCache();
    setNumber(STORAGE_KEYS.lastScanAt, now());
    requestDebugPanelRefresh();

    try {
      const settings = getSettings();
      const watchlist = getWatchlist();
      if (!watchlist.some(isRuleScanning)) return;
      scheduleItemEstimates(watchlist, now(), 'queued');
      let marketValues = getJson(STORAGE_KEYS.marketValues, {});
      if (watchlist.some(rule => isRuleScanning(rule) && rule.useMV)) {
        try { marketValues = await refreshMarketValuesIfNeeded(); }
        catch (error) {
          if (error.cancelled) throw error;
          marketValues = {};
          setLastError('Market values unavailable: ' + error.message);
        }
      }
      assertScan(revision);
      let seenMap = loadSeenMap();
      seenMap = pruneSeenMap(seenMap);

      for (const itemRule of watchlist) {
        if (!canScan(revision) || now() < getNumber('umw_api_backoff_v680', 0)) break;
        if (!isRuleScanning(itemRule)) continue;
        if (itemRule.useMV && !(Number(marketValues[itemRule.itemId]) > 0)) {
          setScanStatus(itemRule.itemId, { ok: false, phase: 'skipped', lastSkipAt: now(), matchFound: false, errorMessage: 'Current market value unavailable' });
          continue;
        }

        try {
          setScanStatus(itemRule.itemId, { phase: 'scanning', lastAttemptAt: now(), nextCheckAt: 0 });
          const result = await scanWatchItem(itemRule, marketValues);
          assertScan(revision);

          recordPriceObservation(itemRule.itemId, result.listings, result.pagesScanned);
          setScanStatus(itemRule.itemId, {
            ok: true, phase: 'idle', lastSuccessAt: now(),
            matchFound: !!(result && result.listing),
            pagesScanned: Number(result?.pagesScanned || 0),
            pagesRequested: Number(result?.pagesRequested || itemRule.pagesToScan || 1),
            listingsScanned: Array.isArray(result?.listings) ? result.listings.length : 0,
            pageDetails: Array.isArray(result?.pageDetails) ? result.pageDetails : [],
            duplicatePageData: !!result?.duplicatePageData,
            uniquePageSignatures: Number(result?.uniquePageSignatures || 0),
            errorMessage: ''
          });

          assertScan(revision);
          dispatchItemMatches(result, marketValues, seenMap, settings);
        } catch (err) {
          if (err.cancelled || !canScan(revision)) break;
          const message = cleanMessage(err.message || err);
          setScanStatus(itemRule.itemId, {
            ok: false, phase: 'error',
            matchFound: false,
            pagesScanned: 0,
            pagesRequested: Math.min(5, Math.max(1, Math.floor(Number(itemRule.pagesToScan) || 1))),
            listingsScanned: 0,
            pageDetails: [],
            duplicatePageData: false,
            uniquePageSignatures: 0,
            errorMessage: message
          });
          setLastError(`${itemRule.displayName}: ${message}`);
        }

        await sleep(600);
      }

      if (canScan(revision)) saveSeenMap(seenMap);
      requestDebugPanelRefresh();
    } catch (err) {
      if (!err.cancelled) setLastError(err.message || String(err));
    } finally {
      isRunningLoop = false;
      const statuses = loadScanStatusMap();
      for (const entry of Object.values(statuses)) if (entry && (entry.phase === 'scanning' || entry.phase === 'queued')) entry.phase = 'idle';
      saveScanStatusMap(statuses);
      scheduleItemEstimates(getWatchlist(), now() + getSettings().pollMs, 'idle');
    }
  }

  function installAccessibilityStyles() {
    const style = document.createElement('style');
    style.textContent = `#umw-debug-panel,#umw-badge-wrap,#umw-toasts{--umw-bg:#10171c;--umw-surface:#182229;--umw-raised:#202d35;--umw-line:#2c3b43;--umw-ink:#edf4f4;--umw-muted:#a2b5bd;--umw-accent:#9fe4be;--umw-warning:#edc480;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--umw-ink);color-scheme:dark;text-align:left}
#umw-debug-panel *,#umw-badge-wrap *,#umw-toasts *{box-sizing:border-box}
#umw-debug-panel{position:fixed;z-index:999999;top:50%;left:50%;transform:translate(-50%,-50%);width:min(840px,calc(100vw - 40px));height:min(800px,calc(100dvh - 100px));display:flex;flex-direction:column;background:var(--umw-bg);border:1px solid #3a4b53;border-radius:22px;box-shadow:0 24px 90px #0009;overflow:hidden;isolation:isolate}
#umw-debug-panel h1,#umw-debug-panel h2,#umw-debug-panel h3,#umw-debug-panel p{margin:0;padding:0;border:0;background:none;color:inherit;text-shadow:none;font-family:inherit}
#umw-debug-panel h1{font-size:20px;line-height:1.3;font-weight:750;letter-spacing:-.5px}
#umw-debug-panel h2{font-size:19px;line-height:1.35;font-weight:700;letter-spacing:-.3px}
#umw-debug-panel h3{font-size:15px;line-height:1.4;font-weight:650}
#umw-debug-panel button,#umw-debug-panel input,#umw-debug-panel select,#umw-debug-panel textarea,#umw-badge-wrap button,#umw-toasts button{font:inherit;float:none;box-shadow:none;text-shadow:none;letter-spacing:normal;text-transform:none;margin:0}
#umw-debug-panel button,#umw-badge-wrap button,#umw-toasts button{cursor:pointer}
#umw-debug-panel :focus-visible,#umw-badge-wrap :focus-visible,#umw-toasts :focus-visible{outline:2px solid var(--umw-accent);outline-offset:3px}
#umw-debug-panel .umw-muted{color:var(--umw-muted);font-size:12px;font-weight:400}
#umw-debug-panel small{display:block}
#umw-debug-panel .umw-header{padding:22px 26px;display:flex;align-items:center;justify-content:space-between;gap:16px}
#umw-debug-panel .umw-brand{display:flex;gap:12px;align-items:center}
#umw-debug-panel .umw-brandmark{width:43px;height:43px;display:grid;place-items:center;font-size:13px;font-weight:800;letter-spacing:-.5px;color:var(--umw-accent);background:#243c33;border:1px solid #446554;border-radius:13px}
#umw-debug-panel .umw-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:38px;padding:8px 13px;border:1px solid var(--umw-line);border-radius:9px;background:var(--umw-surface);color:var(--umw-ink);font-size:12px;font-weight:600;line-height:1.4;text-decoration:none;white-space:normal}
#umw-debug-panel .umw-btn:hover{background:#2a3a43;border-color:#60757e}
#umw-debug-panel .umw-btn:disabled{opacity:.5;cursor:wait}
#umw-debug-panel .umw-primary{background:var(--umw-accent);border-color:var(--umw-accent);color:#14281e}
#umw-debug-panel .umw-primary:hover{background:#c1f0d5;border-color:#c1f0d5}
#umw-debug-panel .umw-icon-button{font-size:24px;min-width:38px;line-height:1;padding:4px;background:transparent}
#umw-debug-panel .umw-text-button{border-color:transparent;background:transparent;color:var(--umw-accent);padding:6px 0}
#umw-debug-panel .umw-danger{color:#ffaaa4;background:transparent}
#umw-debug-panel .umw-overview{margin:0 26px 20px;padding:15px 17px;border:1px solid #355545;background:#192d25;border-radius:12px;display:flex;align-items:center;justify-content:space-between;gap:18px}
#umw-debug-panel .umw-overview[data-tone=warning]{border-color:#665537;background:#302a20}
#umw-debug-panel .umw-overview[data-tone=idle]{border-color:var(--umw-line);background:var(--umw-surface)}
#umw-debug-panel .umw-status-line{display:flex;gap:9px;align-items:center}
#umw-debug-panel .umw-overview p{margin-top:4px;max-width:470px}
.umw-dot{display:inline-block;width:7px;height:7px;flex:0 0 7px;border-radius:50%;background:var(--umw-accent)}
#umw-debug-panel [data-tone=warning] .umw-dot{background:var(--umw-warning)}
#umw-debug-panel [data-tone=idle] .umw-dot{background:var(--umw-muted)}
#umw-debug-panel .umw-tabs{display:flex;gap:8px;padding:0 26px;border-bottom:1px solid var(--umw-line)}
#umw-debug-panel .umw-tabs .umw-btn{background:transparent;border:0;border-bottom:2px solid transparent;border-radius:0;padding:11px 14px 13px;color:var(--umw-muted);font-size:13px}
#umw-debug-panel .umw-tabs [data-selected=true]{border-bottom-color:var(--umw-accent);color:var(--umw-accent)}
#umw-debug-panel .umw-count{font-size:10px;background:#26343b;padding:1px 6px;border-radius:5px;color:var(--umw-muted)}
#umw-debug-panel .umw-content{min-height:0;overflow:auto;overscroll-behavior:contain;padding:24px 26px;flex:1;scrollbar-width:thin;scrollbar-color:#435b64 transparent}
#umw-debug-panel .umw-footer{display:flex;justify-content:space-between;gap:12px;font-size:11px;color:var(--umw-muted);padding:11px 26px;border-top:1px solid var(--umw-line);background:#131c21}
#umw-debug-panel .umw-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:24px}
#umw-debug-panel .umw-metric{padding:15px 17px;background:var(--umw-surface);border:1px solid var(--umw-line);border-radius:12px}
#umw-debug-panel .umw-metric strong{display:block;font-size:29px;line-height:1.3;font-weight:650;letter-spacing:-1px;margin:5px 0}
#umw-debug-panel .umw-eyebrow,#umw-toasts .umw-eyebrow{display:block;font-size:9px;font-weight:700;letter-spacing:1.1px;color:var(--umw-muted)}
#umw-debug-panel .umw-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px}
#umw-debug-panel .umw-section-heading p{margin-top:5px;max-width:500px}
#umw-debug-panel input:not([type=checkbox]),#umw-debug-panel select,#umw-debug-panel textarea{width:100%;min-width:0;min-height:42px;background:#111b21;color:var(--umw-ink);border:1px solid #3a4e58;border-radius:9px;padding:10px 12px;outline-offset:2px;font-size:13px}
#umw-debug-panel input::placeholder,#umw-debug-panel textarea::placeholder{color:#8aa0ab;opacity:1}
#umw-debug-panel .umw-add{margin-bottom:16px}
#umw-debug-panel .umw-add input{background:var(--umw-surface);min-height:46px}
#umw-debug-panel .umw-search-results{display:grid;gap:4px}
#umw-debug-panel .umw-search-results:not(:empty){padding:8px;background:var(--umw-surface);border:1px solid var(--umw-line);border-radius:10px;margin-top:6px;max-height:240px;overflow:auto}
#umw-debug-panel .umw-search-result{justify-content:space-between;border:0;text-align:left}
#umw-debug-panel .umw-item-list{display:grid;gap:12px}
#umw-debug-panel .umw-item{border:1px solid var(--umw-line);border-radius:13px;background:var(--umw-surface);padding:17px 18px}
#umw-debug-panel .umw-item[data-enabled=false]{background:#141d22}
#umw-debug-panel .umw-item-top{display:flex;align-items:center;justify-content:space-between;gap:15px}
#umw-debug-panel .umw-item-identity{display:flex;align-items:center;gap:12px;min-width:0}
#umw-debug-panel .umw-item-identity h3{overflow-wrap:anywhere}
#umw-debug-panel .umw-item-identity .umw-muted{font-size:9px;letter-spacing:.9px}
#umw-debug-panel .umw-item-icon{width:40px;height:40px;flex:0 0 40px;display:grid;place-items:center;background:#293a44;border:1px solid #3b505b;border-radius:10px;font-size:11px;font-weight:700;color:#b8d4de}
#umw-debug-panel .umw-chips{display:flex;flex-wrap:wrap;gap:6px;margin:13px 0 7px}
#umw-debug-panel .umw-chip{display:inline-flex;font-size:11px;color:#bed1d8;background:#22323b;border-radius:6px;padding:4px 8px}
#umw-debug-panel .umw-item-bottom{display:flex;align-items:center;justify-content:space-between;gap:12px}
#umw-debug-panel .umw-item-bottom>.umw-muted{font-size:11px;overflow-wrap:anywhere}
#umw-debug-panel .umw-switch-row{display:flex;gap:16px;align-items:center;justify-content:space-between;cursor:pointer;margin:12px 0}
#umw-debug-panel .umw-switch-row strong{display:block;font-size:13px;font-weight:550}
#umw-debug-panel .umw-switch-row small{margin-top:4px}
#umw-debug-panel .umw-switch{appearance:none;-webkit-appearance:none;display:block;flex:0 0 37px;width:37px;height:22px;border-radius:99px;border:1px solid #536974;background:#2a3b44;position:relative;cursor:pointer;transition:background .15s}
#umw-debug-panel .umw-switch:before{content:'';position:absolute;left:3px;top:3px;width:14px;height:14px;background:#c7d4d9;border-radius:50%;transition:transform .15s}
#umw-debug-panel .umw-switch:checked{background:var(--umw-accent);border-color:var(--umw-accent)}
#umw-debug-panel .umw-switch:checked:before{transform:translateX(15px);background:#1c3b2b}
#umw-debug-panel .umw-item-toggle{margin:0;min-height:44px}
#umw-debug-panel .umw-item-toggle>span{position:absolute;clip-path:inset(50%);width:1px;height:1px;overflow:hidden}
#umw-debug-panel .umw-rule-editor{border-top:1px solid var(--umw-line);margin-top:13px;padding-top:8px}
#umw-debug-panel .umw-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin:17px 0}
#umw-debug-panel .umw-field{display:flex;flex-direction:column;gap:7px;min-width:0}
#umw-debug-panel .umw-field-label{font-size:12px;font-weight:600}
#umw-debug-panel .umw-editor-footer{display:flex;justify-content:space-between;align-items:center;gap:12px}
#umw-debug-panel .umw-callout{padding:13px 15px;background:#243229;border:1px solid #435a43;border-radius:10px;margin-bottom:24px;display:flex;align-items:center;justify-content:space-between;gap:16px;font-size:12px}
#umw-debug-panel .umw-callout .umw-btn{flex-shrink:0}
#umw-debug-panel .umw-empty{text-align:center;padding:34px 22px;border:1px dashed #3d535e;border-radius:13px}
#umw-debug-panel .umw-empty-symbol{display:block;font-size:35px;color:var(--umw-accent);margin-bottom:8px}
#umw-debug-panel .umw-empty p{max-width:390px;margin:8px auto}
#umw-debug-panel .umw-notice{padding:11px 14px;margin-bottom:16px;border-radius:9px;background:#203a2b;color:#c5efd5;border:1px solid #456b50;font-size:12px}
#umw-debug-panel .umw-notice[data-error=true]{background:#3a2524;border-color:#774643;color:#ffd2ce}
#umw-debug-panel [hidden]{display:none!important}
#umw-debug-panel .umw-settings-card,#umw-debug-panel .umw-tools{border:1px solid var(--umw-line);border-radius:13px;padding:19px;background:var(--umw-surface);margin:18px 0}
#umw-debug-panel .umw-settings-card>p{margin:9px 0 13px}
#umw-debug-panel .umw-tool-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:12px 0}
#umw-debug-panel .umw-tool-row>input,#umw-debug-panel .umw-tool-row>select{flex:1;min-width:140px;width:auto}
#umw-debug-panel .umw-security-note{border-left:2px solid #ad8548;background:#2b2b25;padding:10px 13px;margin:16px 0 12px;font-size:11px;color:#d2c6ac}
#umw-debug-panel .umw-security-note p{margin-top:4px}
#umw-debug-panel .umw-file{position:absolute;width:1px!important;min-height:0!important;clip-path:inset(50%);overflow:hidden}
#umw-debug-panel textarea{resize:vertical;min-height:90px}
#umw-debug-panel .umw-diagnostics{border:1px solid var(--umw-line);border-radius:10px;padding:14px 17px;margin-top:18px}
#umw-debug-panel summary{cursor:pointer;font-size:12px;font-weight:600}
#umw-debug-panel .umw-diagnostic-row{display:flex;gap:20px;justify-content:space-between;border-top:1px solid var(--umw-line);padding:9px 0;font-size:12px;overflow-wrap:anywhere}
#umw-debug-panel .umw-diagnostic-row>span:last-child{text-align:right;max-width:65%}
#umw-debug-panel .umw-history{border:1px solid var(--umw-line);border-radius:12px;padding:18px;margin:12px 0;background:var(--umw-surface)}
#umw-debug-panel .umw-history h3{margin-top:5px}
#umw-debug-panel .umw-history .umw-price{font-size:22px;letter-spacing:-.6px;color:var(--umw-accent)}
#umw-debug-panel .umw-history .umw-item-bottom{margin-top:12px}
#umw-badge-wrap{position:fixed;bottom:max(16px,env(safe-area-inset-bottom));left:16px;z-index:999998}
#umw-badge{display:flex;gap:9px;align-items:center;padding:11px 14px;border:1px solid #466052;border-radius:12px;background:#172a22;color:var(--umw-ink);font-size:12px;font-weight:650;min-height:44px;box-shadow:0 6px 25px #0005!important}
#umw-badge[data-active=false]{background:#202c33;border-color:#465963}
#umw-badge[data-active=false] .umw-dot{background:#c5ac7d}
#umw-badge .umw-launch-status{color:#aac5b5;font-size:10px;padding-left:7px;border-left:1px solid #486052}
#umw-toasts{max-width:410px;left:auto!important;right:18px!important;bottom:80px!important}
#umw-toasts .umw-alert-toast{display:flex;gap:8px;align-items:flex-start;padding:15px;background:#172b23;border:1px solid #587c63;border-radius:13px;box-shadow:0 10px 30px #0006;pointer-events:auto}
#umw-toasts .umw-toast-copy{display:flex;flex-direction:column;gap:6px;flex:1;border:0;background:none;color:#eef7f0;text-align:left;padding:0;font-size:12px;line-height:1.5}
#umw-toasts .umw-toast-copy strong{font-size:15px}
#umw-toasts .umw-toast-close{border:0;background:transparent;color:#c1d3c6;font-size:22px;padding:0 7px;min-height:32px}
@media(max-width:600px){
#umw-debug-panel{width:calc(100vw - 16px);height:calc(100dvh - 88px);max-height:none;border-radius:17px;top:8px;left:8px;transform:none}
#umw-debug-panel .umw-header{padding:16px}#umw-debug-panel h1{font-size:18px}
#umw-debug-panel .umw-overview{margin:0 16px 14px;padding:12px;align-items:flex-start;flex-direction:column;gap:10px}
#umw-debug-panel .umw-overview>.umw-btn{align-self:flex-end;min-height:34px;padding:6px 11px}
#umw-debug-panel .umw-overview p{font-size:11px}
#umw-debug-panel .umw-tabs{padding:0 10px;gap:0}#umw-debug-panel .umw-tabs .umw-btn{flex:1;padding:11px 6px}
#umw-debug-panel .umw-content{padding:18px 16px}#umw-debug-panel .umw-footer{padding:9px 16px}
#umw-debug-panel .umw-metrics{gap:7px;margin-bottom:20px}#umw-debug-panel .umw-metric{padding:10px 9px;border-radius:9px}
#umw-debug-panel .umw-metric strong{font-size:24px}#umw-debug-panel .umw-metric small{font-size:10px}#umw-debug-panel .umw-eyebrow{font-size:8px;letter-spacing:.5px}
#umw-debug-panel .umw-toolbar{flex-wrap:wrap;gap:9px}#umw-debug-panel .umw-item{padding:14px}
#umw-debug-panel .umw-callout{flex-direction:column;align-items:flex-start;padding:12px}
#umw-debug-panel .umw-form-grid{grid-template-columns:1fr;gap:13px}
#umw-debug-panel .umw-item-bottom{align-items:flex-start}#umw-debug-panel .umw-item-bottom .umw-btn{flex-shrink:0}
#umw-debug-panel .umw-btn{min-height:42px}#umw-debug-panel .umw-settings-card,#umw-debug-panel .umw-tools{padding:14px}
#umw-debug-panel .umw-editor-footer{flex-wrap:wrap}#umw-debug-panel input:not([type=checkbox]),#umw-debug-panel textarea,#umw-debug-panel select{font-size:16px}
#umw-toasts{left:12px!important;right:12px!important;max-width:none}#umw-badge-wrap{bottom:max(12px,env(safe-area-inset-bottom));left:12px}
}

#umw-debug-panel .umw-group-bar{display:flex;gap:12px;align-items:flex-end;margin:12px 0 18px}
#umw-debug-panel .umw-group-bar .umw-field{flex:1}
#umw-debug-panel .umw-freshness{display:flex;flex-direction:column;gap:3px}
#umw-debug-panel .umw-snooze-row{display:flex;align-items:center;gap:16px;padding:14px 0;border-top:1px solid var(--umw-line)}
#umw-debug-panel .umw-snooze-row>label{flex:1;min-width:145px}
#umw-debug-panel .umw-snooze-row>.umw-muted{flex:1}
#umw-debug-panel .umw-price-history{border-top:1px solid var(--umw-line);padding:16px 0;margin-top:8px}
#umw-debug-panel .umw-price-history svg{width:100%;height:auto;display:block;color:var(--umw-accent);background:#111c22;border-radius:8px;margin:12px 0}
#umw-debug-panel .umw-history-summary{font-size:12px;margin-top:12px}
#umw-debug-panel .umw-price-history table{width:100%;border-collapse:collapse;font-size:11px;text-align:left}
#umw-debug-panel .umw-price-history td,#umw-debug-panel .umw-price-history th{padding:7px 4px;border-bottom:1px solid var(--umw-line)}
#umw-debug-panel .umw-history-samples,#umw-debug-panel .umw-digest-detail{padding:12px 0}
#umw-debug-panel .umw-digest-detail p{padding:6px 0}
#umw-debug-panel .umw-history .umw-price{font-size:18px;overflow-wrap:anywhere}
@media(max-width:600px){#umw-debug-panel .umw-snooze-row{flex-direction:column;align-items:stretch}#umw-debug-panel .umw-group-bar{flex-wrap:wrap}}


#umw-badge .umw-launch-compact{display:none}
@media(max-width:600px),(hover:none) and (pointer:coarse) and (max-width:1000px){
  #umw-badge-wrap{left:8px;bottom:max(8px,env(safe-area-inset-bottom))}
  #umw-badge{position:relative;justify-content:center;width:44px;height:44px;min-height:44px;padding:0;gap:0;border-radius:12px}
  #umw-badge .umw-launch-label,#umw-badge .umw-launch-status{display:none}
  #umw-badge .umw-launch-compact{display:block;font-size:12px;font-weight:750;line-height:1}
  #umw-badge .umw-dot{position:absolute;top:5px;right:5px;width:5px;height:5px;margin:0}
}


#item-market-root .umw-listing-exact{outline:3px solid #54d693!important;outline-offset:-3px;background-color:#163e2c!important;scroll-margin:90px 0}
#item-market-root .umw-listing-possible{outline:3px dashed #e8b85b!important;outline-offset:-3px;scroll-margin:90px 0}
#umw-listing-focus{position:fixed;z-index:1000001;top:max(8px,env(safe-area-inset-top));right:8px;max-width:min(350px,calc(100vw - 16px));display:flex;align-items:center;gap:10px;padding:8px 10px;background:#152329;color:#edf4f4;border:1px solid #547666;border-radius:10px;font:12px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 3px 12px #0004}
#umw-listing-focus button{flex-shrink:0;width:32px;height:32px;border:0;border-radius:6px;background:#293d43;color:#fff;font:20px sans-serif;cursor:pointer}

#umw-debug-panel{box-sizing:border-box;min-width:0;min-height:0;max-width:none;max-height:none;border-radius:16px}
#umw-debug-panel .umw-header{padding:12px 16px;gap:8px;touch-action:none;cursor:move;flex-shrink:0}
#umw-debug-panel .umw-brand{gap:9px;min-width:0}
#umw-debug-panel .umw-brand h1{font-size:17px;white-space:nowrap}
#umw-debug-panel .umw-brand .umw-muted{font-size:10px}
#umw-debug-panel .umw-brandmark{width:32px;height:32px;border-radius:9px;flex-shrink:0}
#umw-debug-panel .umw-window-tools{display:flex;gap:3px;flex-shrink:0;align-items:center}
#umw-debug-panel .umw-window-button,#umw-debug-panel .umw-window-tools .umw-icon-button{padding:0;min-width:32px;width:32px;min-height:34px;height:34px;font-size:20px;background:transparent;border:1px solid transparent;border-radius:7px}
#umw-debug-panel .umw-window-button:hover{background:var(--umw-raised)}
#umw-debug-panel [data-panel-move]{cursor:grab;touch-action:none}
#umw-debug-panel .umw-overview{margin:0 16px 10px;padding:10px 12px;flex-direction:row;align-items:center;gap:10px;flex-shrink:0}
#umw-debug-panel .umw-overview p{font-size:11px}
#umw-debug-panel .umw-tabs{padding:0 12px;flex-shrink:0}
#umw-debug-panel .umw-content{padding:16px;overflow-x:hidden}
#umw-debug-panel .umw-footer{position:relative;padding:8px 48px 8px 16px;min-height:36px;flex-shrink:0;align-items:center}
#umw-debug-panel .umw-resize-grip{position:absolute;right:0;bottom:0;width:36px;height:36px;min-height:36px;padding:0;cursor:nwse-resize;touch-action:none;background:transparent;border:0;color:var(--umw-muted);font-size:22px}
#umw-debug-panel .umw-form-grid{grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:12px}
#umw-debug-panel .umw-item-list{grid-template-columns:1fr;align-items:start}
#umw-debug-panel .umw-item,#umw-debug-panel .umw-history{min-width:0;overflow-wrap:anywhere}
#umw-debug-panel .umw-toolbar,#umw-debug-panel .umw-item-bottom,#umw-debug-panel .umw-editor-footer{flex-wrap:wrap}
#umw-debug-panel .umw-metrics{gap:8px;margin-bottom:18px}
#umw-debug-panel .umw-metric{padding:10px 12px}
#umw-debug-panel .umw-metric strong{font-size:24px}
#umw-debug-panel .umw-history[role=link]{cursor:pointer;transition:border-color .12s,background .12s}
#umw-debug-panel .umw-history[role=link]:hover{border-color:var(--umw-accent);background:#20332d}
#umw-debug-panel .umw-history .umw-price{font-size:19px}
#umw-debug-panel[data-layout=wide] .umw-item-list{grid-template-columns:repeat(2,minmax(0,1fr))}
#umw-debug-panel[data-layout=wide] .umw-item[data-expanded=true]{grid-column:1/-1}
#umw-debug-panel[data-layout=compact] .umw-brandmark,#umw-debug-panel[data-layout=compact] .umw-brand .umw-muted{display:none}
#umw-debug-panel[data-layout=compact] .umw-brand h1{font-size:14px}
#umw-debug-panel[data-layout=compact] .umw-header{padding:10px}
#umw-debug-panel[data-layout=compact] .umw-overview{margin:0 10px 8px;padding:8px 10px}
#umw-debug-panel[data-layout=compact] .umw-overview p{display:none}
#umw-debug-panel[data-layout=compact] .umw-content{padding:12px}
#umw-debug-panel[data-layout=compact] .umw-form-grid{grid-template-columns:1fr}
#umw-debug-panel[data-layout=compact] .umw-tabs{gap:0;padding:0 6px}
#umw-debug-panel[data-layout=compact] .umw-tabs .umw-btn{flex:1;padding:9px 4px}
#umw-debug-panel[data-layout=compact] .umw-metric{padding:8px}
#umw-debug-panel[data-layout=compact] .umw-metric small{display:none}
#umw-debug-panel[data-layout=compact] .umw-snooze-row,#umw-debug-panel[data-layout=compact] .umw-callout{flex-direction:column;align-items:stretch}
#umw-debug-panel[data-short=true] .umw-brand .umw-muted,#umw-debug-panel[data-short=true] .umw-overview p{display:none}
#umw-debug-panel[data-short=true] .umw-header{padding-top:6px;padding-bottom:6px}
#umw-debug-panel[data-short=true] .umw-metrics{display:none}
#umw-debug-panel[data-short=true] .umw-overview{margin-bottom:6px;padding-top:5px;padding-bottom:5px}
#umw-debug-panel[data-short=true] .umw-tabs .umw-btn{padding-top:7px;padding-bottom:7px}


@media(prefers-reduced-motion:reduce){#umw-debug-panel *,#umw-toasts *{transition:none!important}}
`;
    (document.head || document.documentElement).appendChild(style);
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && isDebugVisible()) {
        event.preventDefault(); setDebugVisible(false); rebuildDebugPanel(); badgeEl?.focus();
      }
    });
  }

  async function waitForBody() {
    while (!document.body) {
      await sleep(50);
    }
  }


  let rwModule = null;
  function getRwModule() {
    if (rwModule) return rwModule;
    const legacyHistory = key => /umw_rwtest_(history_|idb_migration)/.test(key);
    const storageKey = key => legacyHistory(key) ? key : key.replace('umw_rwtest_', 'umw_rw_');
    const ready = () => !pageSuspended && storageHealthy && isEnabled() && isMembershipActive() && !!getEffectiveApiKey();
    const assertReady = () => {
      if (!ready()) throw Object.assign(new Error('Connect your account and resume Market Watcher in Settings before scanning RW items.'), {cancelled:true});
    };
    rwModule = createRwModule({
      get(key,fallback) {
        const target=storageKey(key);
        const raw=localStore.getItem(target) ?? (target!==key ? localStore.getItem(key) : null);
        try { return raw === null ? fallback : JSON.parse(raw); } catch (_) { return fallback; }
      },
      set(key,value) { localStore.setItem(storageKey(key),JSON.stringify(value)); },
      remove(key) { localStore.removeItem(storageKey(key)); if (storageKey(key)!==key) localStore.removeItem(key); },
      key:getEffectiveApiKey, clean:cleanMessage, ready, assertReady,
      watchlist:()=>getWatchlist().filter(r=>r.enabled!==false).map(r=>Number(r.itemId)).filter(Number.isSafeInteger),
      open:()=>{designState.tab='rw';setDebugVisible(true);setDebugPanelMinimized(false);rebuildDebugPanel();},
      settings:()=>{designState.tab='settings';requestDebugPanelRefresh(true);},
      minimize:()=>{setDebugVisible(false);rebuildDebugPanel();updateBadge();},
      async request(raw) {
        assertReady();
        const url=new URL(raw);
        if(url.origin!=='https://api.torn.com' || !/^\/v2\/(market|torn)\//.test(url.pathname)) throw new Error('Unexpected RW API endpoint');
        const revision=scanRevision, key=getEffectiveApiKey();
        const guard=()=>{assertReady();if(revision!==scanRevision || key!==getEffectiveApiKey()) throw Object.assign(new Error('RW scan cancelled; watcher settings changed.'),{cancelled:true});};
        url.searchParams.set('key',key);
        return apiFetch(url.toString(),null,guard);
      },
    });
    return rwModule;
  }

  // RW Scout module: persistence, requests and account access belong to the host.
  function createRwModule(host) {
  const VERSION = '7.3.0';
  const CALIBRATION_MODEL_ID = 'rw-accuracy-v10';
  const RW_DB_NAME = 'umw_rw_sales_v1';
  const RW_DB_VERSION = 1;
  const API_BASE = 'https://api.torn.com/v2';
  const STORAGE = {
    apiKey: 'umw_rwtest_apiKey_v1',
    watchlist: 'umw_rwtest_watchlist_v1',
    settings: 'umw_rwtest_settings_v1',
    historyPrefix: 'umw_rwtest_history_v4.',
    historyIndex: 'umw_rwtest_history_index_v1',
    itemDetailsPrefix: 'umw_rwtest_itemdetails_v1.',
    itemDetailsCache: 'umw_rwtest_itemdetails_cache_v2',
    health: 'umw_rwtest_health_v1',
    dbMigration: 'umw_rwtest_idb_migration_v1',
    calibrationFallback: 'umw_rwtest_calibration_v1',
  };

  const DEFAULT_SETTINGS = {
    marketFeePct: 5,
    historyDays: 365,
    maxAuctionPages: 4,
    auctionPageLimit: 100,
    maxMarketPages: 2,
    historyCacheMinutes: 360,
    historyDeepSyncHours: 72,
    historyPerItemCap: 600,
    historyStorageBudgetKb: 1800,
    historyIdleDays: 90,
    itemDetailsCacheCap: 900,
    itemDetailsCacheDays: 120,
    requestGapMs: 900,
    maxListingsPerItem: 40,
    minCompScore: 50,
    maxCompsShown: 20,
    auctionTargetRoiPct: 10,
    auctionMinProfit: 10000000,
    auctionSafetyPct: 3,
    auctionAbsoluteRoiPct: 5,
    auctionAbsoluteMinProfit: 5000000,
    auctionAbsoluteSafetyPct: 1,
    auctionMinConfidence: 60,
    highlightMinProfit: 10000000,
    highlightMinRoiPct: 10,
    highlightMinConfidence: 60,
    highlightMinLiquidity: 20,
    highlightMaxCapital: 0,
    highlightDirectOnly: false,
    marketSanityEnabled: true,
    marketSanityCacheMinutes: 15,
    endingSoonMinutes: 10,
    autoAuctionSniper: false,
    calibrationEnabled: true,
    calibrationMinSamples: 6,
    calibrationMaxAdjustPct: 8,
    calibrationBacktestPerItem: 12,
    calibrationRefreshHours: 24,
  };


  // ---------------------------------------------------------------------------
  // RW valuation normalization data
  // ---------------------------------------------------------------------------
  // Weapon bonus class ranges are encoded from the current Torn Wiki table.
  // A dual-bonus Orange/Red weapon can contain one bonus from the weapon's class
  // and one from the class below, so range resolution checks both applicable
  // classes and chooses the range that best contains the observed roll.
  const WEAPON_BONUS_RANGES = Object.freeze({
    achilles:{Y:[50,73],O:[77,98],R:[114,169]}, assassinate:{Y:[50,69],O:[70,97],R:[101,148]},
    backstab:{Y:[30,40],O:[37,52],R:[44,96]}, berserk:{Y:[20,34],O:[39,53],R:[60,87]},
    bleed:{Y:[20,30],O:[31,45],R:[53,72]}, blindside:{Y:[25,37],O:[41,59],R:[73,96]},
    bloodlust:{Y:[10,12],O:[12,14],R:[17,17]}, comeback:{Y:[50,66],O:[70,99],R:[102,127]},
    conserve:{Y:[25,29],O:[30,36],R:[43,49]}, cripple:{Y:[20,28],O:[29,40],R:[52,58]},
    crusher:{Y:[50,72],O:[76,102],R:[133,133]}, cupid:{Y:[50,74],O:[75,110],R:[124,158]},
    deadeye:{Y:[25,45],O:[46,73],R:[75,123]}, deadly:{Y:[2,3],O:[4,6],R:[9,9]},
    disarm:{Y:[3,5],O:[5,9],R:[9,15]}, 'double edged':{Y:[10,15],O:[16,24],R:[32,32]},
    'double tap':{Y:[15,23],O:[25,35],R:[39,57]}, empower:{Y:[52,85],O:[90,140],R:[180,234]},
    eviscerate:{Y:[15,18],O:[19,24],R:[26,34]}, execute:{Y:[15,18],O:[18,22],R:[23,28]},
    expose:{Y:[7,9],O:[10,14],R:[14,21]}, finale:{Y:[10,11],O:[12,13],R:[13,17]},
    focus:{Y:[15,19],O:[20,24],R:[32,35]}, frenzy:{Y:[5,7],O:[7,9],R:[10,14]},
    fury:{Y:[10,15],O:[16,23],R:[26,36]}, grace:{Y:[20,31],O:[38,49],R:[60,76]},
    'home run':{Y:[50,59],O:[62,71],R:[71,93]}, motivation:{Y:[15,19],O:[19,25],R:[26,35]},
    paralyze:{Y:[5,8],O:null,R:[17,18]}, parry:{Y:[50,59],O:[62,71],R:[71,87]},
    penetrate:{Y:[25,29],O:[30,37],R:[38,49]}, plunder:{Y:[20,25],O:[26,33],R:[36,50]},
    powerful:{Y:[15,21],O:[22,32],R:[33,49]}, proficience:{Y:[20,28],O:[29,38],R:[44,59]},
    puncture:{Y:[15,27],O:[28,39],R:[30,57]}, quicken:{Y:[50,88],O:[91,149],R:[154,245]},
    rage:{Y:[4,6],O:[4,10],R:[11,18]}, revitalize:{Y:[10,13],O:[13,17],R:[18,24]},
    roshambo:{Y:[50,69],O:[76,90],R:[132,132]}, slow:{Y:[20,28],O:[29,42],R:[43,64]},
    smurf:{Y:[1,1],O:[2,3],R:[3,5]}, specialist:{Y:[20,27],O:[28,38],R:[40,52]},
    stricken:{Y:[30,43],O:[44,54],R:[85,99]}, stun:{Y:[10,15],O:[16,23],R:[25,40]},
    suppress:{Y:[25,31],O:[33,40],R:null}, 'sure shot':{Y:[3,4],O:[5,8],R:[8,11]},
    throttle:{Y:[50,71],O:[76,105],R:[119,170]}, warlord:{Y:[15,19],O:[20,27],R:[28,45]},
    weaken:{Y:[20,28],O:[29,40],R:[44,63]}, 'wind up':{Y:[125,145],O:[145,167],R:[177,221]},
    wither:{Y:[20,28],O:[29,42],R:[43,63]},
  });

  const BONUS_KEY_ALIASES = Object.freeze({
    'double-edged':'double edged', 'double edged':'double edged', 'doubletap':'double tap',
    'wind-up':'wind up', 'windup':'wind up', 'sure-shot':'sure shot', 'hom erun':'home run',
    conservative:'conserve', conservation:'conserve', paralyzed:'paralyze', proficient:'proficience',
    proficiency:'proficience', suppression:'suppress',
  });

  // Armor bonuses use slot-specific ranges rather than weapon rarity classes.
  const ARMOR_BONUS_RANGES = Object.freeze({
    impregnable:{all:[20,29]}, impenetrable:{all:[20,29]}, insurmountable:{all:[30,39]}, impassable:{all:[20,28]},
    invulnerable:{'gas mask':[12,14],body:[8,10],pants:[7,9],gloves:[4,6],boots:[4,7]},
    imperviable:{'face mask':[5,7],body:[7,10],pants:[4,6],gloves:[2,3],boots:[2,3]},
    immutable:{helmet:[30,40],body:[40,50],pants:[25,31],gloves:[15,18],boots:[15,19]},
    irrepressible:{helmet:[30,39],body:[40,52],pants:[25,33],gloves:[15,19],boots:[15,19]},
  });

  const MODEL_CONSTANTS = Object.freeze({
    compTimeDecayDays: 180,
    compTimeFloor: 0.25,
    regimeRecentDays: 45,
    regimeOlderDays: 180,
    regimeMaxAdjust: 0.12,
    dualBonusBlendMax: 0.28,
    statPercentileMinSamples: 6,
  });

  const state = {
    settings: loadSettings(),
    watchlist: loadWatchlist(),
    busy: false,
    lastResults: [],
    expandedKey: null,
    status: 'Ready',
    requestQueue: Promise.resolve(),
    auctionRowByKey: new Map(),
    historyItemIds: new Set(),
    autoAuctionTimer: null,
    autoAuctionLastSignature: '',
    autoAuctionPending: false,
    autoAuctionObserver: null,
    autoBidRefreshTimer: null,
    auctionScanGeneration: 0,
    historyRefreshingIds: new Set(),
    marketSanityCache: new Map(),
    dbMode: 'initializing',
    dbReady: false,
    dbError: '',
    db: null,
    dbReadyPromise: null,
    historyMemory: new Map(),
    historyIndexMemory: {},
    calibrationMemory: new Map(),
    calibrationRunning: new Set(),
    migrationStats: { migrated: 0, skipped: 0, failed: 0, legacyFound: 0, completedAt: 0 },
    uiView: 'sniper',
  };

  // ---------------------------------------------------------------------------
  // Storage / environment
  // ---------------------------------------------------------------------------

  function gmGet(key, fallback) { return host.get(key, fallback); }

  function gmSet(key, value) { host.set(key, value); }

  function gmDelete(key) { host.remove(key); }

  // ---------------------------------------------------------------------------
  // IndexedDB RW sales database
  // ---------------------------------------------------------------------------

  function idbRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
    });
  }

  function openRwDatabase() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB is unavailable in this browser/webview')); return; }
      const req = indexedDB.open(RW_DB_NAME, RW_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'itemId' });
        if (!db.objectStoreNames.contains('calibration')) db.createObjectStore('calibration', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Unable to open IndexedDB'));
      req.onblocked = () => reject(new Error('IndexedDB upgrade is blocked by another Torn tab'));
    });
  }

  function idbStore(name, mode = 'readonly') {
    if (!state.db) throw new Error('RW IndexedDB is not ready');
    return state.db.transaction(name, mode).objectStore(name);
  }

  async function idbGetAll(name) {
    return idbRequest(idbStore(name).getAll());
  }

  // A successful request is not proof of a committed transaction.
  function idbWrite(name, action, value) {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(name, 'readwrite');
      tx.oncomplete = () => resolve(true);
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('RW database write was not committed'));
      const store = tx.objectStore(name);
      if (action === 'clear') store.clear(); else store[action](value);
    });
  }

  async function idbPut(name, value) { return idbWrite(name, 'put', value); }

  async function idbDelete(name, key) { return idbWrite(name, 'delete', key); }

  async function idbClear(name) { return idbWrite(name, 'clear'); }

  function legacyHistoryIds() {
    const ids = new Set(Object.keys(gmGet(STORAGE.historyIndex, {}) || {}).map(Number).filter(n => Number.isSafeInteger(n) && n > 0));
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) || '';
        if (!key.startsWith(STORAGE.historyPrefix)) continue;
        const id = Number(key.slice(STORAGE.historyPrefix.length));
        if (Number.isSafeInteger(id) && id > 0) ids.add(id);
      }
    } catch (_) {}
    return [...ids];
  }

  function estimatePackedBytes(packed) {
    try { return JSON.stringify(packed).length * 2; } catch (_) { return 0; }
  }

  function historyRecordFromBundle(bundle) {
    const clean = { ...bundle, sales: pruneHistorySales(bundle.sales || []), exactItemRows: 0 };
    clean.exactItemRows = clean.sales.length;
    clean.savedAt = Number(clean.savedAt) || Date.now();
    const packed = packHistoryBundle(clean);
    return {
      itemId: Number(clean.requestedItemId),
      packed,
      bytes: estimatePackedBytes(packed),
      sales: clean.sales.length,
      updatedAt: Date.now(),
      lastSyncAt: Number(clean.lastSyncAt || clean.savedAt || 0),
      lastDeepSyncAt: Number(clean.lastDeepSyncAt || 0),
    };
  }

  async function persistHistoryRecord(bundle) {
    if (state.dbMode !== 'indexeddb' || !state.db) return false;
    const record = historyRecordFromBundle(bundle);
    await idbPut('history', record);
    return true;
  }

  async function persistCalibrationEntry(entry) {
    if (!entry?.key) return;
    if (state.dbMode === 'indexeddb' && state.db) await idbPut('calibration', entry);
    else {
      const fallback = gmGet(STORAGE.calibrationFallback, {});
      fallback[entry.key] = entry;
      gmSet(STORAGE.calibrationFallback, fallback);
    }
  }

  async function deleteCalibrationEntry(key) {
    state.calibrationMemory.delete(key);
    if (state.dbMode === 'indexeddb' && state.db) await idbDelete('calibration', key);
    else {
      const fallback = gmGet(STORAGE.calibrationFallback, {});
      delete fallback[key];
      gmSet(STORAGE.calibrationFallback, fallback);
    }
  }

  async function migrateLegacyHistoryToIndexedDb() {
    const previous = gmGet(STORAGE.dbMigration, null);
    const ids = legacyHistoryIds();
    if (!ids.length && previous?.completedAt) {
      state.migrationStats = { ...previous };
      return state.migrationStats;
    }
    const migration = { migrated: 0, skipped: 0, failed: 0, legacyFound: ids.length, completedAt: 0 };
    for (const itemId of ids) {
      try {

        const packed = gmGet(`${STORAGE.historyPrefix}${itemId}`, null);
        const bundle = unpackHistoryBundle(packed, itemId);
        if (!bundle?.sales?.length) { migration.skipped += 1; continue; }
        const clean = { ...bundle, requestedItemId: itemId, sales: mergeHistorySales(state.historyMemory.get(itemId)?.sales || [], bundle.sales) };
        const record = historyRecordFromBundle(clean);
        await idbPut('history', record);
        const verified = await idbRequest(idbStore('history').get(itemId));
        if (JSON.stringify(verified?.packed) !== JSON.stringify(record.packed)) throw new Error('RW migration verification failed');
        state.historyMemory.set(itemId, clean);
        state.historyIndexMemory[String(itemId)] = { b: record.bytes, s: record.sales, u: Date.now(), y: record.lastSyncAt };
        // Delete only after IndexedDB confirms the write.
        gmDelete(`${STORAGE.historyPrefix}${itemId}`);
        migration.migrated += 1;
      } catch (_) { migration.failed += 1; }
    }
    if (migration.failed === 0) gmDelete(STORAGE.historyIndex);
    migration.completedAt = Date.now();
    state.migrationStats = migration;
    gmSet(STORAGE.dbMigration, migration);
    return migration;
  }

  async function initializeRwDatabase() {
    try {
      state.db = await openRwDatabase();
      state.dbMode = 'indexeddb';
      const records = await idbGetAll('history');
      for (const record of records || []) {
        const itemId = Number(record?.itemId);
        const bundle = unpackHistoryBundle(record?.packed, itemId);
        if (!Number.isSafeInteger(itemId) || !bundle) continue;
        state.historyMemory.set(itemId, bundle);
        state.historyIndexMemory[String(itemId)] = {
          b: Math.max(0, Number(record.bytes) || estimatePackedBytes(record.packed)),
          s: Math.max(0, Number(record.sales) || bundle.sales.length),
          u: Number(record.updatedAt) || Date.now(), y: Number(record.lastSyncAt) || 0,
        };
      }
      const calibration = await idbGetAll('calibration');
      for (const entry of calibration || []) if (entry?.key && entry.modelId === CALIBRATION_MODEL_ID) state.calibrationMemory.set(entry.key, entry);
      await migrateLegacyHistoryToIndexedDb();
      state.dbReady = true;
      // Build/refresh calibration lazily from already-stored histories without
      // blocking startup or auction-page rendering.
      let delay = 50;
      for (const [itemId, bundle] of state.historyMemory.entries()) {
        setTimeout(() => scheduleCalibrationBacktest(itemId, bundle?.sales || [], false), delay);
        delay += 35;
      }
      return true;
    } catch (error) {
      state.dbMode = 'legacy-fallback';
      state.dbError = cleanApiErrorMessage(error);
      const index = gmGet(STORAGE.historyIndex, {}) || {};
      state.historyIndexMemory = index && typeof index === 'object' ? { ...index } : {};
      const fallbackCalibration = gmGet(STORAGE.calibrationFallback, {}) || {};
      for (const entry of Object.values(fallbackCalibration)) if (entry?.key && entry.modelId === CALIBRATION_MODEL_ID) state.calibrationMemory.set(entry.key, entry);
      state.dbReady = true;
      return false;
    }
  }

  async function ensureRwDatabaseReady() {
    if (state.dbReady) return;
    if (!state.dbReadyPromise) state.dbReadyPromise = initializeRwDatabase();
    await state.dbReadyPromise;
  }

  function loadSettings() {
    const saved=gmGet(STORAGE.settings,{}), result={...DEFAULT_SETTINGS};
    const bounds={historyDays:[30,1500],maxAuctionPages:[1,10],auctionPageLimit:[10,100],maxMarketPages:[1,5],historyCacheMinutes:[1,10080],historyDeepSyncHours:[6,720],historyPerItemCap:[100,2000],historyStorageBudgetKb:[256,4096],historyIdleDays:[7,365],itemDetailsCacheCap:[100,2500],itemDetailsCacheDays:[7,365],maxListingsPerItem:[1,100],maxCompsShown:[1,60],marketFeePct:[0,25],auctionSafetyPct:[0,50],auctionAbsoluteSafetyPct:[0,50],auctionTargetRoiPct:[0,200],auctionAbsoluteRoiPct:[0,200],highlightMinRoiPct:[0,500],auctionMinProfit:[0,1e12],auctionAbsoluteMinProfit:[0,1e12],highlightMinProfit:[0,1e12],highlightMaxCapital:[0,1e12],marketSanityCacheMinutes:[1,1440],endingSoonMinutes:[1,120],calibrationMinSamples:[3,50],calibrationMaxAdjustPct:[0,20],calibrationBacktestPerItem:[4,30],calibrationRefreshHours:[1,720]};
    for (const [key,value] of Object.entries(result)) {
      if (typeof value==='boolean') {if(typeof saved?.[key]==='boolean') result[key]=saved[key];}
      else {const [min,max]=bounds[key]||[0,100];result[key]=clamp(safeNumber(saved?.[key],value),min,max);}
    }
    result.requestGapMs=1250;
    return result;
  }

  function saveSettings() {
    gmSet(STORAGE.settings, state.settings);
  }

  const BASE_UMW_KEYS = Object.freeze({
    apiKey: 'umw_apiKey_v1',
    watchlist: 'umw_watchlist_v56',
    apiNext: 'umw_api_next_v680',
    apiBackoff: 'umw_api_backoff_v680',
  });

  function readBaseWatcherWatchlist() { return host.watchlist(); }

  function loadWatchlist() {
    const own = gmGet(STORAGE.watchlist, []);
    const ownIds = Array.isArray(own)
      ? [...new Set(own.map(Number).filter(Number.isSafeInteger).filter(n => n > 0).slice(0,50))]
      : [];
    if (ownIds.length) return ownIds;
    // First run: mirror the existing Market Watcher entries. This is copied into
    // the test module only; later base-watchlist edits do not mutate test state
    // until the user taps "Sync from MW".
    return readBaseWatcherWatchlist().slice(0, 50);
  }

  function saveWatchlist() {
    gmSet(STORAGE.watchlist, state.watchlist);
  }

  function getApiKey() { return host.key(); }

  function getApiKeySource() { return getApiKey() ? 'Market Watcher account' : 'Connect in main Settings'; }

  function setApiKey() { host.settings(); }

  function syncWatchlistFromMarketWatcher() {
    const ids = readBaseWatcherWatchlist().slice(0, 50);
    state.watchlist = ids;
    saveWatchlist();
    return ids.length;
  }

  function currentItemMarketId() {
    try {
      if (location.pathname !== '/page.php') return 0;
      if (new URLSearchParams(location.search).get('sid')?.toLowerCase() !== 'itemmarket') return 0;
      return Number(new URLSearchParams(location.hash.replace(/^#\/?/, '')).get('itemID')) || 0;
    } catch (_) {
      return 0;
    }
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function safeNumber(v, fallback = null) {
    // Torn uses null for non-applicable equipment stats (e.g. armor on weapons,
    // damage/accuracy on armor). Number(null) is 0 in JavaScript, which would
    // incorrectly make those missing stats look like real zero-valued stats.
    if (v === null || v === undefined || v === '') return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function asArray(v) {
    return Array.isArray(v) ? v : [];
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function fmtMoney(value) {
    if (!Number.isFinite(value)) return '—';
    const abs = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(abs >= 10e9 ? 1 : 2)}b`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(abs >= 10e6 ? 1 : 2)}m`;
    if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(abs >= 10e3 ? 1 : 2)}k`;
    return `${sign}$${Math.round(abs).toLocaleString()}`;
  }

  function fmtNum(value, digits = 2) {
    return Number.isFinite(value) ? Number(value).toFixed(digits) : '—';
  }

  function fmtAgeDays(days) {
    if (!Number.isFinite(days)) return '—';
    if (days < 1) return '<1d';
    if (days < 60) return `${Math.round(days)}d`;
    if (days < 365) return `${(days / 30.44).toFixed(1)}mo`;
    return `${(days / 365.25).toFixed(1)}y`;
  }


  function fmtPct(value, digits = 1) {
    return Number.isFinite(value) ? `${(Number(value) * 100).toFixed(digits)}%` : '—';
  }

  function formatAgoMs(timestampMs) {
    const ts = Number(timestampMs);
    if (!(ts > 0)) return 'never';
    const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function formatUnixDate(timestampSeconds) {
    const ts = Number(timestampSeconds);
    if (!(ts > 0)) return '—';
    try { return new Date(ts * 1000).toLocaleDateString(); } catch (_) { return '—'; }
  }

  // ---------------------------------------------------------------------------
  // HTTP / Torn API
  // ---------------------------------------------------------------------------

  async function requestJson(url) { return host.request(url); }

  function apiErrorFromPayload(data, status = '') {
    const e = data?.error;
    if (typeof e === 'string') return new Error(`Torn API${status ? ` ${status}` : ''}: ${e}`);
    if (e && typeof e === 'object') {
      return new Error(`Torn API${status ? ` ${status}` : ''}: ${e.error || e.message || JSON.stringify(e)}`);
    }
    return new Error(`Torn API request failed${status ? ` (${status})` : ''}.`);
  }

  function cleanApiErrorMessage(error) { return host.clean(error?.message || error || 'Unknown error'); }

  function apiUrl(path, params = {}) {
    const url = new URL(`${API_BASE}/${String(path).replace(/^\/+/, '')}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  async function fetchItemMarket(itemId) {
    const pageLimit = 100;
    const maxPages = Math.max(1, Math.min(5, Math.floor(state.settings.maxMarketPages || 1)));
    let firstMarket = null;
    const listings = [];

    for (let page = 0; page < maxPages; page++) {
      const offset = page * pageLimit;
      setStatus(`Market ${itemId}: page ${page + 1}/${maxPages}…`);
      const payload = await requestJson(apiUrl(`market/${itemId}/itemmarket`, {
        bonus: 'Any',
        limit: pageLimit,
        offset,
      }));
      const market = payload?.itemmarket;
      if (!market) throw new Error(`No itemmarket data returned for item ${itemId}.`);
      if (!firstMarket) firstMarket = market;

      const rows = asArray(market.listings);
      listings.push(...rows);

      // Since May 2026 itemmarket responses expose a total in metadata. Handle
      // both raw API (_metadata) and generated-client (metadata) naming.
      const meta = payload?._metadata || payload?.metadata || {};
      const total = safeNumber(meta?.links?.total ?? meta?.total);
      if (rows.length < pageLimit) break;
      if (Number.isFinite(total) && offset + rows.length >= total) break;
    }

    return { ...firstMarket, listings };
  }

  function findAuctionRows(payload) {
    for (const key of ['auctionhouse', 'auctions', 'listings', 'results', 'data']) {
      if (Array.isArray(payload?.[key])) return payload[key];
    }
    return [];
  }

  function nextAuctionPageUrl(payload) {
    const next = payload?._metadata?.links?.next
      ?? payload?._metadata?.next
      ?? payload?.metadata?.links?.next
      ?? payload?.metadata?.next
      ?? payload?.links?.next
      ?? null;
    if (typeof next !== 'string' || !next.trim()) return null;
    try { return new URL(next, API_BASE).toString(); }
    catch (_) { return null; }
  }

  function fallbackAuctionPageUrl(currentUrl, exactSales, limit) {
    if (!exactSales.length || exactSales.length < limit) return null;
    const oldest = exactSales
      .map(sale => safeNumber(sale?.timestamp))
      .filter(Number.isFinite)
      .reduce((min, ts) => Math.min(min, ts), Infinity);
    if (!Number.isFinite(oldest) || oldest <= 1) return null;
    try {
      const url = new URL(currentUrl);
      url.searchParams.set('to', String(oldest - 1));
      url.searchParams.delete('from');
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('sort', 'DESC');
      return url.toString();
    } catch (_) {
      return null;
    }
  }

  function auctionHistoryEndpoints(itemId, limit) {
    return [{label: `/market/${itemId}/auctionhouse`, url: apiUrl(`market/${itemId}/auctionhouse`, {limit, sort:'DESC'})}];
  }

  function historyIndexGet() {
    if (state.dbMode === 'indexeddb') return { ...(state.historyIndexMemory || {}) };
    const raw = gmGet(STORAGE.historyIndex, {});
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  }

  function historyIndexSet(index) {
    state.historyIndexMemory = { ...(index || {}) };
    if (state.dbMode !== 'indexeddb') gmSet(STORAGE.historyIndex, index || {});
  }

  function historyRarityCode(value) {
    const r = normalizeRarity(value).toLowerCase();
    if (r === 'yellow') return 'Y';
    if (r === 'orange') return 'O';
    if (r === 'red') return 'R';
    return 'U';
  }

  function historyRarityFromCode(value) {
    if (value === 'Y') return 'Yellow';
    if (value === 'O') return 'Orange';
    if (value === 'R') return 'Red';
    return 'Unknown';
  }

  function compactNumber(value, decimals = 2) {
    const n = safeNumber(value);
    if (!Number.isFinite(n)) return null;
    const mul = 10 ** decimals;
    return Math.round(n * mul) / mul;
  }

  function packHistoryBundle(bundle) {
    const bonusNames = [];
    const bonusIndex = new Map();
    const bonusId = title => {
      const key = String(title || '').trim();
      if (!bonusIndex.has(key)) {
        bonusIndex.set(key, bonusNames.length);
        bonusNames.push(key);
      }
      return bonusIndex.get(key);
    };
    const rows = (bundle.sales || []).map(sale => [
      sale.auctionId ?? null,
      Math.floor(safeNumber(sale.timestamp, 0) || 0),
      Math.round(safeNumber(sale.price, 0) || 0),
      sale.uid ?? null,
      historyRarityCode(sale.rarity),
      compactNumber(sale.stats?.damage),
      compactNumber(sale.stats?.accuracy),
      compactNumber(sale.stats?.armor),
      Math.round(safeNumber(sale.bids, 0) || 0),
      (sale.bonuses || []).map(b => [bonusId(b.title), compactNumber(b.value, 3)]),
    ]);
    return {
      v: 1,
      i: Math.floor(Number(bundle.requestedItemId) || 0),
      t: Math.floor(Number(bundle.savedAt) || Date.now()),
      s: Math.floor(Number(bundle.lastSyncAt || bundle.savedAt) || Date.now()),
      d: Math.floor(Number(bundle.lastDeepSyncAt || 0) || 0),
      e: String(bundle.endpoint || ''),
      p: Math.floor(Number(bundle.pagesFetched) || 0),
      w: Math.floor(Number(bundle.rawRows) || 0),
      m: Math.floor(Number(bundle.mismatchedRows) || 0),
      x: Math.floor(Number(bundle.invalidRows) || 0),
      n: bonusNames,
      a: rows,
    };
  }

  function unpackHistoryBundle(raw, itemId) {
    if (!raw || typeof raw !== 'object') return null;
    // Compact v4 database shape.
    if (raw.v === 1 && Array.isArray(raw.a) && Number(raw.i) === Number(itemId)) {
      const names = Array.isArray(raw.n) ? raw.n : [];
      const sales = raw.a.map(row => {
        if (!Array.isArray(row) || row.length < 10) return null;
        const [auctionId, timestamp, price, uid, rarityCode, damage, accuracy, armor, bids, bonusRows] = row;
        if (!Number.isFinite(Number(timestamp)) || !Number.isFinite(Number(price)) || !(Number(timestamp) > 0) || !(Number(price) > 0) || Number(timestamp) > Date.now()/1000) return null;
        return {
          source: 'auction', auctionId: auctionId ?? null, itemId: Number(itemId), itemName: `Item ${itemId}`,
          itemType: armor != null ? 'Armor' : 'Weapon', itemSubType: '', uid: uid ?? null,
          rarity: historyRarityFromCode(rarityCode),
          stats: { damage: safeNumber(damage), accuracy: safeNumber(accuracy), armor: safeNumber(armor), quality: null },
          bonuses: (Array.isArray(bonusRows) ? bonusRows : []).map(pair => ({
            id: null, title: String(names[Number(pair?.[0])] || ''), value: safeNumber(pair?.[1]), description: ''
          })).filter(b => b.title),
          price: Number(price), timestamp: Number(timestamp), bids: Number(bids) || 0,
        };
      }).filter(Boolean);
      return {
        savedAt: Number(raw.t) || 0,
        lastSyncAt: Number(raw.s) || Number(raw.t) || 0,
        lastDeepSyncAt: Number(raw.d) || 0,
        requestedItemId: Number(itemId), endpoint: String(raw.e || '').slice(0,160), pagesFetched: Number(raw.p) || 0,
        rawRows: Number(raw.w) || 0, exactItemRows: sales.length, mismatchedRows: Number(raw.m) || 0,
        invalidRows: Number(raw.x) || 0, sales,
      };
    }
    return null;
  }

  function historySaleKey(sale) {
    return String(sale?.auctionId ?? `${sale?.uid ?? 'nouid'}|${sale?.timestamp ?? 0}|${sale?.price ?? 0}`);
  }

  function historyRetentionSignature(sale) {
    return `${historyRarityCode(sale?.rarity)}|${bonusSignature(sale) || 'none'}`;
  }

  function fitHistoryBudget(sales) {
    const limit=Math.max(256,state.settings.historyStorageBudgetKb)*1024-2048;
    if(sales.length && estimatePackedBytes(packHistoryBundle({requestedItemId:1,sales}))>limit) return pruneHistorySales(sales,Math.floor(sales.length*.75));
    return sales;
  }
  function pruneHistorySales(sales, overrideCap = null) {
    const cutoff = Math.floor(Date.now() / 1000) - Math.max(30, Number(state.settings.historyDays) || 365) * 86400;
    const cap = overrideCap ?? Math.max(100, Math.min(2000, Math.floor(Number(state.settings.historyPerItemCap) || 600)));
    const seen = new Set();
    const valid = [];
    for (const sale of (Array.isArray(sales) ? sales : [])) {
      if (!sale || !Number.isFinite(Number(sale.price)) || !(Number(sale.timestamp) >= cutoff) || Number(sale.timestamp)>Date.now()/1000 || !(Number(sale.price) > 0)) continue;
      const key = historySaleKey(sale);
      if (seen.has(key)) continue;
      seen.add(key);
      valid.push(sale);
    }
    valid.sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
    if (valid.length <= cap) return fitHistoryBudget(valid);

    // Preserve breadth as well as recency. Roughly 45% of the cap is filled in
    // round-robin fashion across rarity + exact bonus signatures, preventing a
    // flood of common rolls from evicting every rare/valuable combination.
    const groups = new Map();
    for (const sale of valid) {
      const sig = historyRetentionSignature(sale);
      if (!groups.has(sig)) groups.set(sig, []);
      groups.get(sig).push(sale);
    }
    const orderedGroups = [...groups.values()].sort((a, b) => Number(b[0]?.timestamp || 0) - Number(a[0]?.timestamp || 0));
    const diverseBudget = Math.max(1, Math.floor(cap * 0.45));
    const picked = [];
    const pickedKeys = new Set();
    let round = 0;
    while (picked.length < diverseBudget) {
      let added = 0;
      for (const group of orderedGroups) {
        const sale = group[round];
        if (!sale) continue;
        const key = historySaleKey(sale);
        if (pickedKeys.has(key)) continue;
        picked.push(sale);
        pickedKeys.add(key);
        added += 1;
        if (picked.length >= diverseBudget) break;
      }
      if (!added) break;
      round += 1;
    }

    // Fill the rest with the newest sales overall so the DB remains highly
    // responsive to current market conditions.
    for (const sale of valid) {
      if (picked.length >= cap) break;
      const key = historySaleKey(sale);
      if (pickedKeys.has(key)) continue;
      picked.push(sale);
      pickedKeys.add(key);
    }
    picked.sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
    return fitHistoryBudget(picked.slice(0, cap));
  }

  function historyStorageStats() {
    const index = historyIndexGet();
    let bytes = 0, sales = 0, items = 0;
    for (const entry of Object.values(index)) {
      if (!entry || typeof entry !== 'object') continue;
      bytes += Math.max(0, Number(entry.b) || 0);
      sales += Math.max(0, Number(entry.s) || 0);
      items += 1;
    }
    return { items, sales, bytes };
  }

  function formatStorageBytes(bytes) {
    const n = Math.max(0, Number(bytes) || 0);
    if (n < 1024) return `${Math.round(n)} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  function healthGet() {
    const raw = gmGet(STORAGE.health, {});
    return raw && typeof raw === 'object' ? raw : {};
  }

  function healthBump(key, amount = 1) {
    const health = healthGet();
    health[key] = Math.max(0, Number(health[key]) || 0) + amount;
    health.updatedAt = Date.now();
    gmSet(STORAGE.health, health);
  }

  function databaseHealthStats() {
    const index = historyIndexGet();
    const counters = healthGet();
    let items = 0, sales = 0, bytes = 0, groups = 0, mismatched = 0, invalid = 0;
    let oldestSale = Infinity, newestSale = 0, oldestSync = Infinity, newestSync = 0;
    for (const [itemId, entry] of Object.entries(index)) {
      if (!entry || typeof entry !== 'object') continue;
      items += 1;
      sales += Math.max(0, Number(entry.s) || 0);
      bytes += Math.max(0, Number(entry.b) || 0);
      const bundle = state.dbMode === 'indexeddb'
        ? state.historyMemory.get(Number(itemId))
        : unpackHistoryBundle(gmGet(`${STORAGE.historyPrefix}${itemId}`, null), Number(itemId));
      if (!bundle) continue;
      groups += new Set((bundle.sales || []).map(historyRetentionSignature)).size;
      mismatched += Math.max(0, Number(bundle.mismatchedRows) || 0);
      invalid += Math.max(0, Number(bundle.invalidRows) || 0);
      for (const sale of (bundle.sales || [])) {
        const ts = Number(sale.timestamp) || 0;
        if (ts > 0) { oldestSale = Math.min(oldestSale, ts); newestSale = Math.max(newestSale, ts); }
      }
      const sync = Number(bundle.lastSyncAt || bundle.savedAt || 0);
      if (sync > 0) { oldestSync = Math.min(oldestSync, sync); newestSync = Math.max(newestSync, sync); }
    }
    const uid = itemDetailsCacheStats();
    const calibration = modelCalibrationStats();
    const budget = Math.max(256, Number(state.settings.historyStorageBudgetKb) || 1800) * 1024;
    return {
      items, sales, bytes, budget, groups, mismatched, invalid,
      oldestSale: Number.isFinite(oldestSale) ? oldestSale : 0,
      newestSale, oldestSync: Number.isFinite(oldestSync) ? oldestSync : 0, newestSync,
      uidEntries: uid.entries, uidBytes: uid.bytes,
      evictions: Math.max(0, Number(counters.evictions) || 0),
      idleEvictions: Math.max(0, Number(counters.idleEvictions) || 0),
      budgetEvictions: Math.max(0, Number(counters.budgetEvictions) || 0),
      dbMode: state.dbMode, dbReady: state.dbReady, dbError: state.dbError,
      schemaVersion: RW_DB_VERSION, migration: { ...(state.migrationStats || {}) }, calibration,
    };
  }

  function deleteHistoryItem(itemId) {
    itemId = Math.floor(Number(itemId));
    if (!itemId) return false;
    const existed = state.dbMode === 'indexeddb' ? state.historyMemory.has(itemId) : !!historyIndexGet()[String(itemId)];
    state.historyMemory.delete(itemId);
    const index = historyIndexGet();
    delete index[String(itemId)];
    historyIndexSet(index);
    if (state.dbMode === 'indexeddb' && state.db) idbDelete('history', itemId).catch(error => { state.dbError=cleanApiErrorMessage(error); });
    else gmDelete(`${STORAGE.historyPrefix}${itemId}`);
    for (const key of [...state.calibrationMemory.keys()].filter(key => key.startsWith(`${itemId}|`))) deleteCalibrationEntry(key).catch(error => { state.dbError=cleanApiErrorMessage(error); });
    return existed;
  }

  function pruneDatabaseNow() {
    const index = historyIndexGet();
    for (const itemId of Object.keys(index)) {
      const bundle = state.dbMode === 'indexeddb'
        ? state.historyMemory.get(Number(itemId))
        : unpackHistoryBundle(gmGet(`${STORAGE.historyPrefix}${itemId}`, null), Number(itemId));
      if (!bundle) continue;
      const pruned = pruneHistorySales(bundle.sales || []);
      const clean = { ...bundle, sales: pruned, exactItemRows: pruned.length, databaseSales: pruned.length, savedAt: Date.now() };
      const record = historyRecordFromBundle(clean);
      if (state.dbMode === 'indexeddb') {
        state.historyMemory.set(Number(itemId), clean);
        persistHistoryRecord(clean).catch(error => { state.dbError=cleanApiErrorMessage(error); });
      } else gmSet(`${STORAGE.historyPrefix}${itemId}`, record.packed);
      index[String(itemId)] = { ...(index[String(itemId)] || {}), b: record.bytes, s: pruned.length, u: Date.now(), y: clean.lastSyncAt || 0 };
    }
    historyIndexSet(index);
    enforceHistoryStorageBudget(null);
    const cache = loadItemDetailsCache();
    saveItemDetailsCache(cache);
  }

  function enforceHistoryStorageBudget(protectedItemId = null) {
    const index = historyIndexGet();
    const nowMs = Date.now();
    const removeItem = id => {
      if (state.dbMode === 'indexeddb') {
        state.historyMemory.delete(Number(id));
        if (state.db) idbDelete('history', Number(id)).catch(error => { state.dbError=cleanApiErrorMessage(error); });
      } else gmDelete(`${STORAGE.historyPrefix}${id}`);
      delete index[id];
    };
    const idleMs = Math.max(7, Number(state.settings.historyIdleDays) || 90) * 86400000;
    for (const [id, entry] of Object.entries(index)) {
      if (Number(id) === Number(protectedItemId)) continue;
      if (entry && Number(entry.u) > 0 && nowMs - Number(entry.u) > idleMs) {
        removeItem(id); healthBump('evictions'); healthBump('idleEvictions');
      }
    }
    const budget = Math.max(256, Number(state.settings.historyStorageBudgetKb) || 1800) * 1024;
    let total = Object.values(index).reduce((sum, entry) => sum + Math.max(0, Number(entry?.b) || 0), 0);
    if (total > budget) {
      const victims = Object.entries(index)
        .filter(([id]) => Number(id) !== Number(protectedItemId))
        .sort((a, b) => (Number(a[1]?.u) || 0) - (Number(b[1]?.u) || 0));
      for (const [id, entry] of victims) {
        if (total <= budget) break;
        total -= Math.max(0, Number(entry?.b) || 0);
        removeItem(id); healthBump('evictions'); healthBump('budgetEvictions');
      }
    }
    historyIndexSet(index);
  }

  function loadPersistentHistory(itemId) {
    itemId = Math.floor(Number(itemId));
    let bundle = null;
    if (state.dbMode === 'indexeddb') bundle = state.historyMemory.get(itemId) || null;
    else bundle = unpackHistoryBundle(gmGet(`${STORAGE.historyPrefix}${itemId}`, null), itemId);
    if (!bundle) return null;
    bundle = { ...bundle, sales: pruneHistorySales(bundle.sales || []) };
    bundle.exactItemRows = bundle.sales.length;
    if (state.dbMode === 'indexeddb') state.historyMemory.set(itemId, bundle);
    const index = historyIndexGet();
    const key = String(itemId);
    if (index[key]) {
      index[key].u = Date.now();
      index[key].s = bundle.sales.length;
      historyIndexSet(index);
    }
    return bundle;
  }

  function savePersistentHistory(bundle) {
    const itemId = Math.floor(Number(bundle.requestedItemId));
    if (!itemId) return bundle;
    const clean = { ...bundle, sales: pruneHistorySales(bundle.sales), exactItemRows: 0 };
    clean.exactItemRows = clean.sales.length;
    clean.savedAt = Date.now();
    const record = historyRecordFromBundle(clean);
    if (state.dbMode === 'indexeddb') {
      state.historyMemory.set(itemId, clean);
      persistHistoryRecord(clean).catch(error => { state.dbError = cleanApiErrorMessage(error); });
    } else gmSet(`${STORAGE.historyPrefix}${itemId}`, record.packed);
    const index = historyIndexGet();
    index[String(itemId)] = { b: record.bytes, s: clean.sales.length, u: Date.now(), y: clean.lastSyncAt || Date.now() };
    historyIndexSet(index);
    enforceHistoryStorageBudget(itemId);
    scheduleCalibrationBacktest(itemId, clean.sales, false);
    return clean;
  }

  function mergeHistorySales(existing, incoming) {
    const map = new Map();
    for (const sale of [...(existing || []), ...(incoming || [])]) {
      if (!sale) continue;
      const key = historySaleKey(sale);
      const prior = map.get(key);
      if (!prior || Number(sale.timestamp) >= Number(prior.timestamp)) map.set(key, sale);
    }
    return pruneHistorySales([...map.values()]);
  }

  function historyAuditFromBundle(bundle = {}) {
    const sales = Array.isArray(bundle.sales) ? bundle.sales : [];
    return {
      requestedItemId: safeNumber(bundle.requestedItemId), endpoint: String(bundle.endpoint || ''),
      pagesFetched: safeNumber(bundle.pagesFetched, 0) || 0, rawRows: safeNumber(bundle.rawRows, 0) || 0,
      exactItemRows: safeNumber(bundle.exactItemRows, sales.length) || 0,
      databaseSales: safeNumber(bundle.databaseSales, sales.length) || 0,
      retentionGroups: new Set(sales.map(historyRetentionSignature)).size,
      newSales: safeNumber(bundle.newSales, 0) || 0, mismatchedRows: safeNumber(bundle.mismatchedRows, 0) || 0,
      invalidRows: safeNumber(bundle.invalidRows, 0) || 0, cached: !!bundle.cached, stale: !!bundle.stale,
      syncMode: String(bundle.syncMode || ''), savedAt: safeNumber(bundle.savedAt), lastSyncAt: safeNumber(bundle.lastSyncAt),
      lastDeepSyncAt: safeNumber(bundle.lastDeepSyncAt), storageBytes: safeNumber(bundle.storageBytes, 0) || 0,
    };
  }

  function loadInstantHistory(itemId) {
    const existing = loadPersistentHistory(itemId);
    if (!existing?.sales?.length) return null;
    const index = historyIndexGet();
    const bytes = Math.max(0, Number(index[String(itemId)]?.b) || estimatePackedBytes(packHistoryBundle(existing)));
    const local = {
      ...existing,
      requestedItemId: Number(itemId),
      exactItemRows: existing.sales.length,
      databaseSales: existing.sales.length,
      newSales: 0,
      cached: true,
      stale: false,
      syncMode: state.dbMode === 'indexeddb' ? 'IndexedDB instant' : 'local instant',
      storageBytes: bytes,
    };
    local.audit = historyAuditFromBundle(local);
    return local;
  }

  function historyNeedsRefresh(bundle, force = false) {
    if (force) return true;
    if (!bundle?.sales?.length) return true;
    const ttl = Math.max(1, Number(state.settings.historyCacheMinutes) || 360) * 60 * 1000;
    const stamp = Number(bundle.lastSyncAt || bundle.savedAt || 0);
    return !stamp || Date.now() - stamp >= ttl;
  }

  async function fetchAuctionHistory(itemId, { force = false } = {}) {
    itemId = Math.floor(Number(itemId));
    if (!Number.isSafeInteger(itemId) || itemId <= 0) throw new Error('Invalid Torn item ID for auction history.');
    state.historyItemIds.add(itemId);

    const nowMs = Date.now();
    const ttl = Math.max(1, Number(state.settings.historyCacheMinutes) || 360) * 60 * 1000;
    const deepMs = Math.max(6, Number(state.settings.historyDeepSyncHours) || 72) * 3600000;
    const existing = loadPersistentHistory(itemId);

    if (!force && existing?.sales?.length && nowMs - Number(existing.lastSyncAt || existing.savedAt || 0) < ttl) {
      const bytes = Math.max(0, Number(historyIndexGet()[String(itemId)]?.b) || estimatePackedBytes(packHistoryBundle(existing)));
      const restored = { ...existing, requestedItemId: itemId, exactItemRows: existing.sales.length,
        databaseSales: existing.sales.length, newSales: 0, cached: true, stale: false, syncMode: state.dbMode === 'indexeddb' ? 'IndexedDB' : 'database', storageBytes: bytes };
      return { ...restored, audit: historyAuditFromBundle(restored) };
    }

    const deepSync = force || !existing?.sales?.length || nowMs - Number(existing.lastDeepSyncAt || 0) >= deepMs;
    const configuredMaxPages = Math.max(1, Math.floor(state.settings.maxAuctionPages));
    const maxPages = deepSync ? configuredMaxPages : Math.min(configuredMaxPages, 2);
    const limit = Math.max(10, Math.min(100, Math.floor(state.settings.auctionPageLimit)));
    const attempts = [];
    const existingKeys = new Set((existing?.sales || []).map(historySaleKey));
    let bestFilteredBundle = null;

    for (const candidate of auctionHistoryEndpoints(itemId, limit)) {
      const exactSales = [];
      let rawRows = 0, mismatchedRows = 0, invalidRows = 0, pagesFetched = 0;
      let url = candidate.url;
      const seenUrls = new Set();

      try {
        for (let page = 0; page < maxPages && url; page++) {
          if (seenUrls.has(url)) break;
          seenUrls.add(url);
          setStatus(`History item ${itemId}: ${deepSync ? 'deep' : 'quick'} sync · page ${page + 1}/${maxPages}…`);
          const payload = await requestJson(url);
          pagesFetched += 1;
          const rows = findAuctionRows(payload);
          rawRows += rows.length;
          if (!rows.length) break;

          const pageExactSales = [];
          let reachedKnownSale = false;
          for (const row of rows) {
            const rawItemId = safeNumber(row?.item?.id ?? row?.item_details?.id ?? row?.itemDetails?.id);
            if (Number.isFinite(rawItemId) && rawItemId !== itemId) { mismatchedRows += 1; continue; }
            const sale = normalizeAuctionSale(row, itemId);
            if (!sale) { invalidRows += 1; continue; }
            if (!deepSync && existingKeys.has(historySaleKey(sale))) reachedKnownSale = true;
            exactSales.push(sale); pageExactSales.push(sale);
          }
          // Incremental refreshes stop as soon as a page overlaps our local DB.
          // There is no value downloading older pages we already possess.
          if (!deepSync && reachedKnownSale) break;
          url = nextAuctionPageUrl(payload) || fallbackAuctionPageUrl(url, pageExactSales, limit);
          if (!url && rows.length < limit) break;
        }
      } catch (error) {
        if (error.cancelled) throw error;
        attempts.push({ endpoint: candidate.label, error: cleanApiErrorMessage(error), rawRows, exactRows: exactSales.length, mismatchedRows });
        continue;
      }

      const deduped = mergeHistorySales([], exactSales);
      attempts.push({ endpoint: candidate.label, rawRows, exactRows: deduped.length, mismatchedRows, invalidRows, pagesFetched });
      if (deduped.length) {
        const bundle = { requestedItemId: itemId, endpoint: candidate.label, pagesFetched, rawRows,
          exactItemRows: deduped.length, mismatchedRows, invalidRows, sales: deduped };
        if (mismatchedRows === 0) { bestFilteredBundle = bundle; break; }
        const contamination = rawRows ? mismatchedRows / rawRows : Infinity;
        const bestContamination = bestFilteredBundle?.rawRows ? bestFilteredBundle.mismatchedRows / bestFilteredBundle.rawRows : Infinity;
        if (!bestFilteredBundle || contamination < bestContamination ||
            (contamination === bestContamination && deduped.length > bestFilteredBundle.exactItemRows)) bestFilteredBundle = bundle;
      }
    }

    if (bestFilteredBundle?.sales?.length) {
      const oldKeys = new Set((existing?.sales || []).map(historySaleKey));
      const mergedSales = mergeHistorySales(existing?.sales || [], bestFilteredBundle.sales);
      const newSales = bestFilteredBundle.sales.reduce((n, sale) => n + (oldKeys.has(historySaleKey(sale)) ? 0 : 1), 0);
      let merged = {
        ...bestFilteredBundle, sales: mergedSales, exactItemRows: mergedSales.length, databaseSales: mergedSales.length,
        newSales, lastSyncAt: nowMs, lastDeepSyncAt: deepSync ? nowMs : Number(existing?.lastDeepSyncAt || 0),
        syncMode: deepSync ? 'deep' : 'incremental', cached: false, stale: false,
      };
      merged = savePersistentHistory(merged);
      merged.storageBytes = Math.max(0, Number(historyIndexGet()[String(itemId)]?.b) || estimatePackedBytes(packHistoryBundle(merged)));
      merged.audit = historyAuditFromBundle(merged);
      return merged;
    }

    // If Torn has a temporary/API parsing failure, keep using the accumulated database.
    if (existing?.sales?.length) {
      const fallback = { ...existing, requestedItemId: itemId, exactItemRows: existing.sales.length,
        databaseSales: existing.sales.length, newSales: 0, cached: true, stale: true, syncMode: 'stale database',
        attempts, error: attempts.map(a => a.error).filter(Boolean).join(' | ') };
      fallback.storageBytes = Math.max(0, Number(historyIndexGet()[String(itemId)]?.b) || estimatePackedBytes(packHistoryBundle(fallback)));
      return { ...fallback, audit: historyAuditFromBundle(fallback) };
    }

    const best = attempts.sort((a, b) => (b.rawRows || 0) - (a.rawRows || 0))[0] || {};
    const emptyBundle = { savedAt: nowMs, lastSyncAt: nowMs, lastDeepSyncAt: deepSync ? nowMs : 0,
      requestedItemId: itemId, endpoint: best.endpoint || auctionHistoryEndpoints(itemId, limit)[0].label,
      pagesFetched: best.pagesFetched || 0, rawRows: best.rawRows || 0, exactItemRows: 0, databaseSales: 0,
      newSales: 0, mismatchedRows: best.mismatchedRows || 0, invalidRows: best.invalidRows || 0,
      sales: [], attempts, syncMode: deepSync ? 'deep' : 'incremental' };
    return { ...emptyBundle, cached: false, audit: historyAuditFromBundle(emptyBundle) };
  }

  async function clearHistoryCache() {
    state.databaseEpoch=(state.databaseEpoch||0)+1;
    if (state.dbMode==='indexeddb' && state.db) {
      await new Promise((resolve,reject)=>{
        const tx=state.db.transaction(['history','calibration'],'readwrite');
        tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error||new Error('Database clear failed'));
        tx.objectStore('history').clear();tx.objectStore('calibration').clear();
      });
    } else {
      for(const id of new Set([...Object.keys(historyIndexGet()),...state.watchlist,...state.historyItemIds])) gmDelete(`${STORAGE.historyPrefix}${id}`);
      gmDelete(STORAGE.historyIndex);gmDelete(STORAGE.calibrationFallback);
    }
    state.historyMemory.clear();state.historyIndexMemory={};state.calibrationMemory.clear();
  }

  // ---------------------------------------------------------------------------
  // Data normalization
  // ---------------------------------------------------------------------------

  function normalizeRarity(value) {
    if (value === null || value === undefined) return 'Unknown';
    if (typeof value === 'string') return value.trim() || 'Unknown';
    if (typeof value === 'object') return String(value.name || value.title || value.value || 'Unknown');
    return String(value);
  }

  function normalizeStats(stats = {}) {
    return {
      damage: safeNumber(stats?.damage),
      accuracy: safeNumber(stats?.accuracy),
      armor: safeNumber(stats?.armor),
      quality: safeNumber(stats?.quality),
    };
  }

  function normalizeBonuses(bonuses) {
    return asArray(bonuses)
      .map(b => ({
        id: b?.id ?? null,
        title: String(b?.title || '').trim(),
        value: safeNumber(b?.value),
        description: String(b?.description || ''),
      }))
      .filter(b => b.title);
  }

  function normalizeAuctionSale(row, expectedItemId = null) {
    const item = row?.item ?? row?.item_details ?? row?.itemDetails;
    if (!item || typeof item !== 'object') return null;

    // Stackable auction items do not carry RW stats/bonuses and are ignored.
    const bonuses = normalizeBonuses(item?.bonuses);
    const rarity = normalizeRarity(item?.rarity);
    if (!bonuses.length && rarity === 'Unknown') return null;

    const itemId = safeNumber(item?.id);
    const price = safeNumber(row?.price);
    const timestamp = safeNumber(row?.timestamp ?? row?.ended_at ?? row?.endedAt);
    if (!Number.isSafeInteger(itemId) || itemId <= 0 || !(price > 0) || !(timestamp > 0) || timestamp > Date.now()/1000) return null;
    if (Number.isFinite(expectedItemId) && itemId !== Number(expectedItemId)) return null;

    return {
      source: 'auction',
      auctionId: row?.id ?? row?.auction_id ?? row?.auctionId ?? null,
      itemId,
      itemName: String(item?.name || `Item ${itemId}`),
      itemType: String(item?.type || ''),
      itemSubType: String(item?.sub_type || item?.subType || ''),
      uid: item?.uid ?? null,
      rarity,
      stats: normalizeStats(item?.stats),
      bonuses,
      price,
      timestamp,
      bids: safeNumber(row?.bids, 0),
    };
  }

  function normalizeMarketListing(parentItem, listing) {
    const d = listing?.item_details;
    if (!d) return null;
    const bonuses = normalizeBonuses(d?.bonuses);
    const rarity = normalizeRarity(d?.rarity);
    if (!bonuses.length && rarity === 'Unknown') return null;

    const itemId = safeNumber(parentItem?.id);
    const price = safeNumber(listing?.price);
    if (!itemId || !price) return null;

    return {
      source: 'market',
      itemId,
      itemName: String(parentItem?.name || `Item ${itemId}`),
      itemType: String(parentItem?.type || ''),
      itemSubType: String(parentItem?.sub_type || ''),
      uid: d?.uid ?? null,
      rarity,
      stats: normalizeStats(d?.stats),
      bonuses,
      price,
      amount: safeNumber(listing?.amount, 1),
    };
  }

  function isRankedWarItem(item) {
    if (!item) return false;
    return Array.isArray(item.bonuses) && item.bonuses.length > 0 && normalizeRarity(item.rarity).toLowerCase() !== 'unknown';
  }

  function itemDetailsRows(payload) {
    const raw = payload?.itemdetails;
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') {
      if (raw.uid != null || raw.id != null) return [raw];
      return Object.values(raw).filter(v => v && typeof v === 'object');
    }
    return [];
  }

  function normalizeItemDetails(detail) {
    if (!detail || typeof detail !== 'object') return null;
    const uid = detail.uid == null ? '' : String(detail.uid);
    const itemId = safeNumber(detail.id);
    if (!uid || !Number.isFinite(itemId)) return null;
    return {
      source: 'itemdetails',
      itemId,
      itemName: String(detail.name || `Item ${itemId}`),
      itemType: String(detail.type || ''),
      itemSubType: String(detail.sub_type || detail.subType || ''),
      uid,
      rarity: normalizeRarity(detail.rarity),
      stats: normalizeStats(detail.stats),
      bonuses: normalizeBonuses(detail.bonuses),
    };
  }

  function loadItemDetailsCache() {
    const raw = gmGet(STORAGE.itemDetailsCache, null);
    if (!raw || typeof raw !== 'object' || raw.v !== 1 || !raw.a || typeof raw.a !== 'object') {
      return { v: 1, a: {} };
    }
    return raw;
  }

  function unpackCachedItemDetail(uid, row) {
    if (!Array.isArray(row) || row.length < 10) return null;
    const [usedAt, itemId, name, type, subType, rarity, damage, accuracy, armor, bonuses] = row;
    if (!(Number(itemId) > 0)) return null;
    return {
      source: 'itemdetails-cache',
      itemId: Number(itemId),
      itemName: String(name || `Item ${itemId}`),
      itemType: String(type || ''),
      itemSubType: String(subType || ''),
      uid: String(uid),
      rarity: normalizeRarity(rarity),
      stats: { damage: safeNumber(damage), accuracy: safeNumber(accuracy), armor: safeNumber(armor), quality: null },
      bonuses: (Array.isArray(bonuses) ? bonuses : []).map(pair => ({
        id: null,
        title: String(pair?.[0] || ''),
        value: safeNumber(pair?.[1]),
        description: '',
      })).filter(b => b.title),
      cacheUsedAt: Number(usedAt) || 0,
    };
  }

  function packCachedItemDetail(detail, usedAt = Date.now()) {
    return [
      Math.floor(usedAt),
      Math.floor(Number(detail.itemId) || 0),
      String(detail.itemName || ''),
      String(detail.itemType || ''),
      String(detail.itemSubType || ''),
      String(detail.rarity || 'Unknown'),
      compactNumber(detail.stats?.damage),
      compactNumber(detail.stats?.accuracy),
      compactNumber(detail.stats?.armor),
      (detail.bonuses || []).map(b => [String(b.title || ''), compactNumber(b.value, 3)]),
    ];
  }

  function pruneItemDetailsCache(cache, protectedUids = []) {
    const nowMs = Date.now();
    const cutoff = nowMs - Math.max(7, Number(state.settings.itemDetailsCacheDays) || 120) * 86400000;
    const cap = Math.max(100, Math.min(2500, Math.floor(Number(state.settings.itemDetailsCacheCap) || 900)));
    const protectedSet = new Set((protectedUids || []).map(String));
    const rows = Object.entries(cache?.a || {})
      .filter(([uid, row]) => protectedSet.has(String(uid)) || (Array.isArray(row) && Number(row[0]) >= cutoff))
      .sort((a, b) => Number(b[1]?.[0] || 0) - Number(a[1]?.[0] || 0));
    const kept = {};
    for (const [uid, row] of rows) {
      if (Object.keys(kept).length >= cap && !protectedSet.has(String(uid))) continue;
      kept[uid] = row;
    }
    return { v: 1, a: kept };
  }

  function saveItemDetailsCache(cache, protectedUids = []) {
    gmSet(STORAGE.itemDetailsCache, pruneItemDetailsCache(cache, protectedUids));
  }

  function itemDetailsCacheStats() {
    const cache = loadItemDetailsCache();
    const entries = Object.keys(cache.a || {}).length;
    let bytes = 0;
    try { bytes = JSON.stringify(cache).length * 2; } catch (_) {}
    return { entries, bytes };
  }

  async function fetchItemDetailsByUids(uids) {
    const unique = [...new Set((uids || []).map(v => String(v || '').trim()).filter(v => /^\d+$/.test(v)))];
    const map = new Map();
    const cache = loadItemDetailsCache();
    const nowMs = Date.now();
    const staleBefore = nowMs - Math.max(7, Number(state.settings.itemDetailsCacheDays) || 120) * 86400000;
    const missing = [];
    let cacheHits = 0;

    for (const uid of unique) {
      const row = cache.a?.[uid];
      const cached = unpackCachedItemDetail(uid, row);
      if (cached && Number(row?.[0] || 0) >= staleBefore) {
        map.set(uid, cached);
        row[0] = nowMs;
        cacheHits += 1;
      } else {
        missing.push(uid);
      }
    }

    let fetched = 0;
    for (let i = 0; i < missing.length; i += 25) {
      const chunk = missing.slice(i, i + 25);
      if (!chunk.length) continue;
      setStatus(`Resolving exact RW details ${Math.min(i + chunk.length, missing.length)}/${missing.length} uncached UIDs…`);
      const payload = await requestJson(apiUrl(`torn/${chunk.join(',')}/itemdetails`));
      for (const row of itemDetailsRows(payload)) {
        const normalized = normalizeItemDetails(row);
        if (!normalized) continue;
        map.set(String(normalized.uid), normalized);
        cache.a[String(normalized.uid)] = packCachedItemDetail(normalized, nowMs);
        fetched += 1;
      }
    }

    // Touch cached rows we used and keep the cache bounded independently of the sold-sales DB.
    for (const uid of unique) {
      if (cache.a?.[uid] && map.has(uid)) cache.a[uid][0] = nowMs;
    }
    saveItemDetailsCache(cache, unique);
    return { map, cacheHits, fetched, requested: unique.length };
  }

  function enrichLiveAuctionTarget(target, detail) {
    if (!detail) return { ...target, detailSource: 'Unresolved UID', detailsResolved: false };
    return {
      ...target,
      detailsResolved: true,
      itemId: detail.itemId,
      itemName: detail.itemName,
      itemType: detail.itemType || target.itemType,
      itemSubType: detail.itemSubType || target.itemSubType,
      rarity: detail.rarity,
      stats: detail.stats,
      bonuses: detail.bonuses,
      uid: detail.uid || target.uid,
      detailSource: detail.source === 'itemdetails-cache' ? 'UID cache' : 'Torn itemdetails API',
    };
  }

  // ---------------------------------------------------------------------------
  // Live Auction House page parsing
  //
  // Torn's official API currently exposes finished auctions, not live open
  // auctions. Live current-bid data is therefore read only from the Auction
  // House page the user has actually opened. No auto-paging or bidding occurs.
  // ---------------------------------------------------------------------------

  const AH = {
    root: '#auction-house-tabs',
    visibleTab: '#auction-house-tabs .tabContent:not([style*="display: none"])',
    row: 'div.items-list-wrap > ul.items-list > li[id]',
    hover: 'span.item-hover',
    currentBid: '.c-bid-wrap',
    timer: '.time[timer]',
    endTitle: 'div.time-wrap span[title]',
    title: '.title',
    itemName: '.item-name',
    rarityLine: '.title p.t-gray-6',
    statsContainer: '.infobonuses',
    statEntry: 'span.bonus-attachment',
    statIcon: 'i',
    statValue: '.label-value',
    bonusIcons: '.iconsbonuses .bonus-attachment-icons',
  };

  function isActiveVisiblePage() {
    return !document.hidden && (typeof document.hasFocus !== 'function' || document.hasFocus());
  }

  function parseMoneyText(text) {
    const digits = String(text || '').replace(/[^0-9]/g, '');
    return digits ? safeNumber(digits) : null;
  }

  function parseAuctionStats(row) {
    const out = { damage: null, accuracy: null, armor: null, quality: null };
    const container = row.querySelector(AH.statsContainer);
    if (!container) return out;

    container.querySelectorAll(AH.statEntry).forEach(entry => {
      const value = safeNumber(parseFloat(entry.querySelector(AH.statValue)?.textContent || ''));
      const iconClass = String(entry.querySelector(AH.statIcon)?.className || '').toLowerCase();
      if (!Number.isFinite(value)) return;
      if (iconClass.includes('damage')) out.damage = value;
      else if (iconClass.includes('accuracy')) out.accuracy = value;
      else if (iconClass.includes('armor') || iconClass.includes('armour') || iconClass.includes('defence')) out.armor = value;
    });
    return out;
  }

  function parseAuctionBonuses(row) {
    const bonuses = [];
    row.querySelectorAll(AH.bonusIcons).forEach(icon => {
      const raw = icon.getAttribute('title') || '';
      if (!raw) return;
      const tmp = document.createElement('div');
      tmp.innerHTML = raw;
      const bold = tmp.querySelector('b');
      const title = String(bold?.textContent || tmp.textContent || '').trim();
      if (!title) return;
      const desc = String(tmp.textContent || '').replace(title, '').trim();
      const match = desc.match(/(-?\d+(?:\.\d+)?)/);
      const value = match ? safeNumber(match[1]) : null;
      bonuses.push({ id: null, title, value, description: desc });
    });
    return bonuses;
  }

  function parseAuctionRarity(row) {
    const candidates = [
      row.querySelector(AH.rarityLine)?.textContent,
      row.querySelector(AH.title)?.textContent,
      row.className,
    ].filter(Boolean).join(' ');
    const m = candidates.match(/\b(yellow|orange|red)\b/i);
    if (!m) return 'Unknown';
    return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  }

  function parseAuctionItemName(row, itemId) {
    const direct = row.querySelector(AH.itemName)?.textContent?.trim();
    if (direct) return direct;
    const title = row.querySelector(AH.title);
    const strong = title?.querySelector('b, strong')?.textContent?.trim();
    if (strong) return strong;
    const hover = row.querySelector(AH.hover);
    const hoverName = hover?.getAttribute('data-name') || hover?.getAttribute('aria-label');
    if (hoverName) return String(hoverName).trim();
    return `Item ${itemId}`;
  }

  function parseLiveAuctionRow(row) {
    if (!row) return null;
    const hover = row.querySelector(AH.hover);
    const itemId = safeNumber(hover?.getAttribute('item'));
    const uidRaw = hover?.getAttribute('armoury');
    const uid = uidRaw ? String(uidRaw) : null;
    const currentBid = parseMoneyText(row.querySelector(AH.currentBid)?.textContent);
    const remainingSeconds = safeNumber(row.querySelector(AH.timer)?.getAttribute('timer'));
    const endTitle = String(row.querySelector(AH.endTitle)?.getAttribute('title') || '').trim();
    if (!itemId || !uid || !Number.isFinite(currentBid)) return null;

    const bonuses = parseAuctionBonuses(row);
    const rarity = parseAuctionRarity(row);
    const stats = parseAuctionStats(row);

    const itemName = parseAuctionItemName(row, itemId);
    const rowKey = `${itemId}:${uid}:${endTitle || remainingSeconds || row.id}`;
    return {
      source: 'auction-live',
      itemId,
      itemName,
      itemType: stats.armor != null ? 'Armor' : 'Weapon',
      itemSubType: '',
      uid,
      rarity,
      stats,
      bonuses,
      price: currentBid,
      currentBid,
      remainingSeconds,
      endTitle,
      rowKey,
      rowId: row.id || null,
      isWinning: row.classList.contains('bg-green'),
      isOutbid: row.classList.contains('bg-red'),
      detailSource: 'DOM fallback',
    };
  }

  function getVisibleAuctionTargets() {
    if (!location.href.includes('amarket.php')) return [];
    if (!isActiveVisiblePage()) return [];
    const visible = document.querySelector(AH.visibleTab) || document.querySelector(AH.root);
    if (!visible) return [];

    state.auctionRowByKey.clear();
    const rows = [];
    visible.querySelectorAll(AH.row).forEach(row => {
      const parsed = parseLiveAuctionRow(row);
      if (!parsed) return;
      rows.push(parsed);
      state.auctionRowByKey.set(parsed.rowKey, row);
    });
    return rows;
  }

  // ---------------------------------------------------------------------------
  // Comparable scoring
  // ---------------------------------------------------------------------------

  function bonusMap(item) {
    const m = new Map();
    for (const b of item?.bonuses || []) m.set(normalizeBonusKey(b.title), b);
    return m;
  }

  function normalizeBonusKey(title) {
    let key = String(title || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
    key = BONUS_KEY_ALIASES[key] || key;
    return key;
  }

  function bonusSignature(item) {
    return [...bonusMap(item).keys()].sort().join('|');
  }

  function rarityClassCode(rarity) {
    const r = String(rarity || '').trim().toLowerCase();
    if (r.includes('yellow') || r.includes('superior')) return 'Y';
    if (r.includes('orange') || r.includes('epic')) return 'O';
    if (r.includes('red') || r.includes('legendary')) return 'R';
    return 'U';
  }

  function armorSlotKey(itemName) {
    const name = String(itemName || '').toLowerCase();
    if (name.includes('gas mask')) return 'gas mask';
    if (name.includes('face mask')) return 'face mask';
    if (name.includes('helmet')) return 'helmet';
    if (name.includes('body') || name.includes('apron')) return 'body';
    if (name.includes('pants') || name.includes('trousers')) return 'pants';
    if (name.includes('gloves')) return 'gloves';
    if (name.includes('boots')) return 'boots';
    return 'all';
  }

  function rangePercentile(value, range) {
    if (!Number.isFinite(value) || !Array.isArray(range) || range.length < 2) return null;
    const lo = Number(range[0]), hi = Number(range[1]);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    if (hi <= lo) return 0.5;
    return clamp((value - lo) / (hi - lo), 0, 1);
  }

  function resolveBonusRange(item, bonus) {
    const value = safeNumber(bonus?.value);
    const key = normalizeBonusKey(bonus?.title);
    if (!key || !Number.isFinite(value)) return null;

    const isArmor = Number.isFinite(item?.stats?.armor) || String(item?.itemType || '').toLowerCase() === 'armor';
    if (isArmor && ARMOR_BONUS_RANGES[key]) {
      const table = ARMOR_BONUS_RANGES[key];
      const slot = armorSlotKey(item?.itemName);
      const range = table[slot] || table.all || null;
      if (range) return { key, classCode:'A', range, min:range[0], max:range[1], percentile:rangePercentile(value, range), source:'official armor', outOfRange:value < range[0] || value > range[1] };
    }

    const table = WEAPON_BONUS_RANGES[key];
    if (!table) return null;
    const rarity = rarityClassCode(item?.rarity);
    const candidates = rarity === 'Y' ? ['Y'] : rarity === 'O' ? ['O','Y'] : rarity === 'R' ? ['R','O'] : ['Y','O','R'];
    const rows = candidates.map(code => ({ code, range: table[code] })).filter(row => Array.isArray(row.range));
    if (!rows.length) return null;

    let chosen = rows.find(row => value >= row.range[0] - 1e-9 && value <= row.range[1] + 1e-9);
    if (!chosen) {
      chosen = rows.slice().sort((a,b) => {
        const dist = r => value < r.range[0] ? r.range[0] - value : value > r.range[1] ? value - r.range[1] : 0;
        return dist(a) - dist(b);
      })[0];
    }
    const [min,max] = chosen.range;
    return { key, classCode:chosen.code, range:chosen.range, min, max, percentile:rangePercentile(value, chosen.range), source:'official weapon', outOfRange:value < min || value > max };
  }

  function targetBonusProfile(item) {
    return (item?.bonuses || []).map(b => {
      const resolved = resolveBonusRange(item, b);
      return {
        title: String(b.title || ''), value: safeNumber(b.value), key: normalizeBonusKey(b.title),
        classCode: resolved?.classCode || 'U', min: resolved?.min ?? null, max: resolved?.max ?? null,
        percentile: resolved?.percentile ?? null, source: resolved?.source || 'adaptive fallback', outOfRange: !!resolved?.outOfRange,
      };
    });
  }

  function rollSimilarity(targetItem, compItem, bonusName, targetValue, compValue) {
    if (!Number.isFinite(targetValue) || !Number.isFinite(compValue)) return 0;
    if (targetValue === compValue) return 1;
    const tRange = resolveBonusRange(targetItem, { title: bonusName, value: targetValue });
    const cRange = resolveBonusRange(compItem, { title: bonusName, value: compValue });
    if (tRange && cRange && Number.isFinite(tRange.percentile) && Number.isFinite(cRange.percentile)) {
      const percentileSim = clamp(1 - Math.abs(tRange.percentile - cRange.percentile), 0, 1);
      const globalLo = Math.min(tRange.min, cRange.min), globalHi = Math.max(tRange.max, cRange.max);
      const absoluteSim = globalHi > globalLo ? clamp(1 - Math.abs(targetValue - compValue) / (globalHi - globalLo), 0, 1) : percentileSim;
      let sim = 0.8 * percentileSim + 0.2 * absoluteSim;
      // Orange and Red dual-bonus gear can carry a lower-class bonus. Two 90th
      // percentile rolls from different classes are not economically equivalent.
      if (tRange.classCode !== cRange.classCode && tRange.classCode !== 'A' && cRange.classCode !== 'A') sim *= 0.42;
      return clamp(sim, 0, 1);
    }
    const scale = Math.max(3, Math.abs(targetValue) * 0.25, Math.abs(compValue) * 0.25);
    return clamp(1 - Math.abs(targetValue - compValue) / scale, 0, 1);
  }

  function statSimilarity(a, b, tolerance) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    return clamp(1 - Math.abs(a - b) / tolerance, 0, 1);
  }

  function percentileRank(values, value) {
    if (!Number.isFinite(value)) return null;
    const xs = (Array.isArray(values) ? values : []).filter(Number.isFinite).sort((a,b)=>a-b);
    if (xs.length < MODEL_CONSTANTS.statPercentileMinSamples) return null;
    let below = 0, equal = 0;
    for (const x of xs) { if (x < value) below += 1; else if (Math.abs(x - value) < 1e-9) equal += 1; }
    return clamp((below + 0.5 * equal) / xs.length, 0, 1);
  }

  function buildStatContext(target, rows) {
    const rarity = String(target?.rarity || '').toLowerCase();
    const same = (Array.isArray(rows) ? rows : []).filter(row => row && row.itemId === target.itemId && String(row.rarity || '').toLowerCase() === rarity);
    const extract = key => same.map(row => safeNumber(row?.stats?.[key])).filter(Number.isFinite);
    const context = { sampleCount:same.length, damage:extract('damage'), accuracy:extract('accuracy'), armor:extract('armor') };
    context.target = {
      damage: percentileRank(context.damage, safeNumber(target?.stats?.damage)),
      accuracy: percentileRank(context.accuracy, safeNumber(target?.stats?.accuracy)),
      armor: percentileRank(context.armor, safeNumber(target?.stats?.armor)),
    };
    return context;
  }

  function statPercentileSimilarity(target, comp, context) {
    if (!context) return null;
    if (Number.isFinite(target?.stats?.armor) && Number.isFinite(comp?.stats?.armor)) {
      const a = context.target?.armor, b = percentileRank(context.armor, comp.stats.armor);
      return Number.isFinite(a) && Number.isFinite(b) ? clamp(1 - Math.abs(a-b),0,1) : null;
    }
    const td = context.target?.damage, cd = percentileRank(context.damage, comp?.stats?.damage);
    const ta = context.target?.accuracy, ca = percentileRank(context.accuracy, comp?.stats?.accuracy);
    if (![td,cd,ta,ca].every(Number.isFinite)) return null;
    return clamp(((1-Math.abs(td-cd)) + (1-Math.abs(ta-ca))) / 2, 0, 1);
  }

  function ageDays(timestamp) {
    if (!Number.isFinite(timestamp)) return Infinity;
    return Math.max(0, valuationNow() - timestamp) / 86400;
  }

  function scoreComparable(target, comp, statContext = null) {
    const breakdown = { item:0, rarity:0, bonus:0, roll:0, stats:0, recency:0 };
    if (target.itemId === comp.itemId) breakdown.item = 30;

    const sameRarity = String(target.rarity).toLowerCase() === String(comp.rarity).toLowerCase();
    if (sameRarity) breakdown.rarity = 20;

    const tMap = bonusMap(target), cMap = bonusMap(comp);
    const tNames = [...tMap.keys()], cNames = [...cMap.keys()];
    const intersection = tNames.filter(name => cMap.has(name));
    const union = new Set([...tNames, ...cNames]);
    const exactBonusSet = tNames.length > 0 && tNames.length === cNames.length && intersection.length === tNames.length;
    if (exactBonusSet) breakdown.bonus = 20;
    else if (intersection.length > 0) breakdown.bonus = 20 * (intersection.length / Math.max(1, union.size));

    let knownRollMatches = 0;
    if (intersection.length > 0) {
      const rollSims = intersection.map(name => {
        const tb = tMap.get(name), cb = cMap.get(name);
        if (resolveBonusRange(target, tb) && resolveBonusRange(comp, cb)) knownRollMatches += 1;
        return rollSimilarity(target, comp, name, tb?.value, cb?.value);
      });
      breakdown.roll = 15 * (rollSims.reduce((a,b)=>a+b,0) / rollSims.length);
      if (!exactBonusSet) breakdown.roll *= 0.75;
    }

    const percentileSim = statPercentileSimilarity(target, comp, statContext);
    if (Number.isFinite(percentileSim)) {
      breakdown.stats = 10 * percentileSim;
    } else if (Number.isFinite(target.stats.armor) && Number.isFinite(comp.stats.armor)) {
      breakdown.stats = 10 * statSimilarity(target.stats.armor, comp.stats.armor, 6);
    } else {
      breakdown.stats = 5 * statSimilarity(target.stats.damage, comp.stats.damage, 8) + 5 * statSimilarity(target.stats.accuracy, comp.stats.accuracy, 8);
    }

    const days = ageDays(comp.timestamp);
    breakdown.recency = 5 * Math.exp(-days / 240);
    const total = Object.values(breakdown).reduce((a,b)=>a+b,0);
    let tier = 'WEAK';
    if (breakdown.item === 30 && sameRarity && exactBonusSet) tier = 'DIRECT';
    else if (breakdown.item === 30 && sameRarity && intersection.length > 0) tier = 'STRONG';
    else if (breakdown.item === 30 && sameRarity) tier = 'BASE';

    return {
      ...comp,
      sameUid:Boolean(target.uid && comp.uid && String(target.uid) === String(comp.uid)),
      matchScore:Math.round(total*10)/10,
      breakdown,tier,exactBonusSet,ageDays:days,
      knownRollMatches,
      statPercentileSimilarity:percentileSim,
    };
  }

  function buildMarketSanity(target, listings, historicalFair = null) {
    const nowSec = Math.floor(valuationNow());
    const rows = (Array.isArray(listings) ? listings : []).filter(row => row && String(row.uid || '') !== String(target.uid || ''));
    const statContext = buildStatContext(target, rows);
    const scored = rows
      .map(row => scoreComparable(target, { ...row, timestamp: nowSec }, statContext))
      .filter(row => row.tier !== 'WEAK' && Number(row.price) > 0)
      .sort((a,b)=>b.matchScore-a.matchScore);
    const direct = scored.filter(c=>c.tier==='DIRECT'), strong = scored.filter(c=>c.tier==='STRONG'), base = scored.filter(c=>c.tier==='BASE');
    let mode='none', selected=[];
    if (direct.length>=2) { mode='direct asks'; selected=direct; }
    else if (direct.length && strong.length) { mode='direct + strong asks'; selected=[...direct,...strong]; }
    else if (strong.length>=2) { mode='strong asks'; selected=strong; }
    else if (base.length>=4) { mode='base asks'; selected=base; }
    selected = selected.slice(0,30);
    if (!selected.length) return { available:false,count:0,mode,direct:direct.length,strong:strong.length,base:base.length,statSamples:statContext.sampleCount };
    const prices = selected.map(x=>Number(x.price)).filter(Number.isFinite).sort((a,b)=>a-b);
    const low = prices[Math.floor((prices.length-1)*.25)], medianAsk=median(prices), high=prices[Math.floor((prices.length-1)*.75)];
    const vsHistoryPct = Number.isFinite(historicalFair) && historicalFair>0 && Number.isFinite(medianAsk) ? medianAsk/historicalFair-1 : null;
    return { available:true,count:selected.length,mode,low,median:medianAsk,high,direct:direct.length,strong:strong.length,base:base.length,
      bestScore:scored[0]?.matchScore ?? null, vsHistoryPct, statSamples:statContext.sampleCount };
  }

  async function getCurrentMarketSnapshot(itemId, { force = false } = {}) {
    itemId = Math.floor(Number(itemId));
    if (!itemId) return null;
    const ttl = Math.max(1, Number(state.settings.marketSanityCacheMinutes) || 15) * 60000;
    const cached = state.marketSanityCache.get(itemId);
    if (!force && cached && Date.now() - cached.at < ttl) return { ...cached, cached: true };
    const payload = await requestJson(apiUrl(`market/${itemId}/itemmarket`, { bonus: 'Any', limit: 100, offset: 0 }));
    const market = payload?.itemmarket;
    if (!market) throw new Error(`No current market data returned for item ${itemId}.`);
    const parent = market.item || { id: itemId, name: `Item ${itemId}` };
    const listings = asArray(market.listings).map(row => normalizeMarketListing(parent, row)).filter(isRankedWarItem);
    const snapshot = { at: Date.now(), itemId, listings, cached: false };
    state.marketSanityCache.set(itemId, snapshot);
    return snapshot;
  }

  function freshnessInfo(audit, refreshing = false) {
    const lastSync = Number(audit?.lastSyncAt || audit?.savedAt || 0);
    const age = lastSync > 0 ? Date.now() - lastSync : Infinity;
    const ttl = Math.max(1, Number(state.settings.historyCacheMinutes) || 360) * 60000;
    if (audit?.stale) return { label: 'STALE FALLBACK', ageMs: age, lastSync };
    if (refreshing) return { label: 'LOCAL + REFRESHING', ageMs: age, lastSync };
    if (String(audit?.syncMode || '').toLowerCase().includes('deep') || String(audit?.syncMode || '').toLowerCase().includes('incremental')) {
      return { label: 'FRESH', ageMs: age, lastSync };
    }
    if (lastSync > 0 && age < ttl) return { label: 'FRESH LOCAL', ageMs: age, lastSync };
    if (audit?.databaseSales > 0 || audit?.exactItemRows > 0) return { label: 'LOCAL', ageMs: age, lastSync };
    return { label: 'NO HISTORY', ageMs: age, lastSync };
  }


  // ---------------------------------------------------------------------------
  // Pricing / confidence / deal scoring
  // ---------------------------------------------------------------------------

  function weightedQuantile(rows, q) {
    if (!rows.length) return null;
    const sorted = [...rows].sort((a, b) => a.price - b.price);
    const totalWeight = sorted.reduce((s, r) => s + r.weight, 0);
    if (totalWeight <= 0) return null;
    const target = totalWeight * q;
    let running = 0;
    for (const row of sorted) {
      running += row.weight;
      if (running >= target) return row.price;
    }
    return sorted.at(-1).price;
  }

  function median(numbers) {
    const xs = numbers.filter(Number.isFinite).sort((a, b) => a - b);
    if (!xs.length) return null;
    const mid = Math.floor(xs.length / 2);
    return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  }

  function trimPriceOutliers(rows) {
    if (rows.length < 7) return rows;
    const prices = rows.map(r=>Number(r.price)).filter(p=>p>0);
    if (prices.length < 7) return rows;
    const logs = prices.map(Math.log);
    const med = median(logs);
    const mad = median(logs.map(x=>Math.abs(x-med))) || 0;
    const threshold = Math.max(3.5*mad, 0.24);
    const kept = rows.filter(r => Math.abs(Math.log(Number(r.price)) - med) <= threshold);
    return kept.length >= Math.max(4, Math.floor(rows.length*0.55)) ? kept : rows;
  }

  function trimPriceOutliersByTier(rows) {
    const tiers = new Map();
    for (const row of rows) { const key=String(row.tier||'WEAK'); if(!tiers.has(key))tiers.set(key,[]); tiers.get(key).push(row); }
    return [...tiers.values()].flatMap(group=>trimPriceOutliers(group)).sort((a,b)=>b.matchScore-a.matchScore);
  }

  function compWeight(comp) {
    const similarity = Math.pow(clamp(comp.matchScore / 100, 0, 1), 5);
    const tierMultiplier = comp.tier === 'DIRECT' ? 1 : comp.tier === 'STRONG' ? 0.28 : comp.tier === 'BASE' ? 0.05 : 0.01;
    const uidMultiplier = comp.sameUid ? 2.1 : 1;
    const age = Math.max(0, safeNumber(comp.ageDays, 9999));
    const timeMultiplier = MODEL_CONSTANTS.compTimeFloor + (1-MODEL_CONSTANTS.compTimeFloor) * Math.exp(-age / MODEL_CONSTANTS.compTimeDecayDays);
    return Math.max(0.0001, similarity * tierMultiplier * uidMultiplier * timeMultiplier);
  }

  function calculateLiquidity(scored, eligibleHistory, target) {
    const direct30=scored.filter(c=>c.tier==='DIRECT'&&c.ageDays<=30).length, direct90=scored.filter(c=>c.tier==='DIRECT'&&c.ageDays<=90).length;
    const strong30=scored.filter(c=>c.tier==='STRONG'&&c.ageDays<=30).length, strong90=scored.filter(c=>c.tier==='STRONG'&&c.ageDays<=90).length;
    const sameRarity30=eligibleHistory.filter(s=>String(s.rarity).toLowerCase()===String(target.rarity).toLowerCase()&&ageDays(s.timestamp)<=30).length;
    const equivalentMonthlySales = direct30 + .35*strong30 + .10*sameRarity30 + .20*Math.max(0,direct90-direct30) + .07*Math.max(0,strong90-strong30);
    const score=Math.round(100*(1-Math.exp(-equivalentMonthlySales/6)));
    const label=score>=75?'HIGH':score>=45?'MEDIUM':score>=20?'LOW':'VERY LOW';
    const expectedDays = equivalentMonthlySales > 0.05 ? clamp(30/equivalentMonthlySales, 1, 180) : 180;
    const speedLabel = expectedDays <= 3 ? 'VERY FAST' : expectedDays <= 7 ? 'FAST' : expectedDays <= 21 ? 'MODERATE' : expectedDays <= 60 ? 'SLOW' : 'VERY SLOW';
    return { score,label,direct30,direct90,strong30,strong90,sameRarity30,equivalentMonthlySales,expectedDays,speedLabel };
  }

  function calculateTrend(pricingComps) {
    const recent=pricingComps.filter(c=>c.ageDays<=45).map(c=>c.price), older=pricingComps.filter(c=>c.ageDays>45&&c.ageDays<=180).map(c=>c.price);
    if(recent.length<2||older.length<2)return{label:'UNKNOWN',pct:null,recentCount:recent.length,olderCount:older.length};
    const recentMedian=median(recent), olderMedian=median(older);
    if(!(recentMedian>0)||!(olderMedian>0))return{label:'UNKNOWN',pct:null,recentCount:recent.length,olderCount:older.length};
    const pct=recentMedian/olderMedian-1, label=pct>=.07?'RISING':pct<=-.07?'FALLING':'FLAT';
    return{label,pct,recentMedian,olderMedian,recentCount:recent.length,olderCount:older.length};
  }

  function calculateMarketRegime(eligibleHistory, target, pricingComps) {
    const same = eligibleHistory.filter(s=>String(s.rarity).toLowerCase()===String(target.rarity).toLowerCase());
    const recent=same.filter(s=>ageDays(s.timestamp)<=MODEL_CONSTANTS.regimeRecentDays).map(s=>s.price);
    const older=same.filter(s=>ageDays(s.timestamp)>MODEL_CONSTANTS.regimeRecentDays&&ageDays(s.timestamp)<=MODEL_CONSTANTS.regimeOlderDays).map(s=>s.price);
    if(recent.length<5||older.length<5)return{available:false,rawPct:null,appliedPct:0,recentCount:recent.length,olderCount:older.length};
    const recentMedian=median(recent), olderMedian=median(older);
    if(!(recentMedian>0)||!(olderMedian>0))return{available:false,rawPct:null,appliedPct:0,recentCount:recent.length,olderCount:older.length};
    const rawPct=recentMedian/olderMedian-1;
    const support=clamp(Math.min(recent.length,older.length)/15,0,1);
    const oldShare=pricingComps.length?pricingComps.reduce((s,c)=>s+clamp((c.ageDays-MODEL_CONSTANTS.regimeRecentDays)/(MODEL_CONSTANTS.regimeOlderDays-MODEL_CONSTANTS.regimeRecentDays),0,1),0)/pricingComps.length:0;
    const appliedPct=clamp(rawPct*.55*support*oldShare,-MODEL_CONSTANTS.regimeMaxAdjust,MODEL_CONSTANTS.regimeMaxAdjust);
    return{available:true,rawPct,appliedPct,recentMedian,olderMedian,recentCount:recent.length,olderCount:older.length,support,oldShare};
  }

  function weightedMedianSimple(rows) {
    const weighted=(rows||[]).map(row=>({...row,weight:MODEL_CONSTANTS.compTimeFloor+(1-MODEL_CONSTANTS.compTimeFloor)*Math.exp(-ageDays(row.timestamp)/MODEL_CONSTANTS.compTimeDecayDays)}));
    return weightedQuantile(weighted,.5);
  }

  function calculateDualBonusModel(target, eligibleHistory) {
    const names=[...bonusMap(target).keys()];
    if(names.length!==2)return null;
    const same=eligibleHistory.filter(s=>String(s.rarity).toLowerCase()===String(target.rarity).toLowerCase());
    const exact=same.filter(s=>bonusSignature(s)===bonusSignature(target));
    const supports=names.map(name=>{const rows=same.filter(s=>bonusMap(s).has(name));return{name,count:rows.length,median:weightedMedianSimple(rows)};});
    if(supports.some(x=>x.count<2||!(x.median>0)))return{available:false,supports,exactCount:exact.length};
    const synthetic=Math.sqrt(supports[0].median*supports[1].median);
    const exactMedian=exact.length?weightedMedianSimple(exact):null;
    let estimate=synthetic, source='two single-bonus anchors';
    if(exact.length&&exactMedian>0){const exactWeight=clamp(exact.length/3,0.35,0.8);estimate=exactMedian*exactWeight+synthetic*(1-exactWeight);source='exact combo + single-bonus anchors';}
    return{available:true,supports,exactCount:exact.length,synthetic,exactMedian,estimate,source};
  }

  function targetStatProfile(target, statContext) {
    const t=statContext?.target||{};
    return{sampleCount:statContext?.sampleCount||0,damage:t.damage,accuracy:t.accuracy,armor:t.armor};
  }

  let valuationTime = null;
  function valuationNow() { return valuationTime === null ? Date.now()/1000 : valuationTime; }
  function buildValuationAt(target, history, timestamp) {
    const previous = valuationTime;
    try { valuationTime = timestamp; return buildValuationRaw(target, history); }
    finally { valuationTime = previous; }
  }
  function buildValuationRaw(target, history) {
    const historyCutoff=valuationNow()-state.settings.historyDays*86400;
    const eligibleHistory=history.filter(s=>Number(s.itemId)===Number(target.itemId) && Number.isFinite(s.price) && s.price>0 && s.timestamp>=historyCutoff && s.timestamp<valuationNow());
    const sameRarityHistoryCount=eligibleHistory.filter(s=>String(s.rarity).toLowerCase()===String(target.rarity).toLowerCase()).length;
    const exactBonusHistoryCount=eligibleHistory.filter(s=>bonusSignature(s)===bonusSignature(target)&&String(s.rarity).toLowerCase()===String(target.rarity).toLowerCase()).length;
    const statContext=buildStatContext(target,eligibleHistory);
    const bonusProfile=targetBonusProfile(target);
    const bonusRangeCoverage=bonusProfile.length?bonusProfile.filter(x=>Number.isFinite(x.percentile)).length/bonusProfile.length:0;
    const scored=eligibleHistory.map(comp=>scoreComparable(target,comp,statContext)).filter(comp=>comp.matchScore>=state.settings.minCompScore).filter(comp=>comp.tier!=='WEAK').sort((a,b)=>b.matchScore-a.matchScore);
    const direct=scored.filter(c=>c.tier==='DIRECT'), strong=scored.filter(c=>c.tier==='STRONG'), base=scored.filter(c=>c.tier==='BASE');
    const liquidity=calculateLiquidity(scored,eligibleHistory,target);
    const sameUidHistory=eligibleHistory.filter(s=>target.uid&&s.uid&&String(target.uid)===String(s.uid)).sort((a,b)=>a.timestamp-b.timestamp);

    let pricingMode='insufficient', pricingComps=[];
    if(direct.length>=3){pricingMode='direct';pricingComps=direct;}
    else if(direct.length>0&&strong.length>0){pricingMode='direct + strong';pricingComps=[...direct,...strong];}
    else if(strong.length>=2){pricingMode='strong';pricingComps=strong;}
    else if(base.length>=4){pricingMode='base fallback';pricingComps=base;}
    else pricingComps=[...direct,...strong,...base];

    pricingComps=trimPriceOutliersByTier(pricingComps.slice(0,60));
    const weighted=pricingComps.map(c=>({...c,weight:compWeight(c)}));
    const trend=calculateTrend(pricingComps), dualBonus=calculateDualBonusModel(target,eligibleHistory), regime=calculateMarketRegime(eligibleHistory,target,pricingComps);

    const shared={target,allComps:scored.slice(0,state.settings.maxCompsShown),pricingComps:weighted,directCount:direct.length,strongCount:strong.length,baseCount:base.length,exactCount:direct.length,partialCount:strong.length,pricingMode,liquidity,trend,historyCount:eligibleHistory.length,sameRarityHistoryCount,exactBonusHistoryCount,bonusProfile,bonusRangeCoverage,statProfile:targetStatProfile(target,statContext),sameUidHistory,dualBonus,regime};
    if(weighted.length<2)return{...shared,low:null,fair:null,high:null,anchorLow:null,anchorFair:null,anchorHigh:null,confidence:0,confidenceLabel:'LOW',confidenceParts:null,valuationExplanation:[]};

    const anchorLow=weightedQuantile(weighted,.25), anchorFair=weightedQuantile(weighted,.50), anchorHigh=weightedQuantile(weighted,.75);
    let low=anchorLow,fair=anchorFair,high=anchorHigh;
    let dualBlendWeight=0;
    if(dualBonus?.available&&Number.isFinite(dualBonus.estimate)&&direct.length<3&&Number.isFinite(fair)){
      dualBlendWeight=clamp((3-direct.length)/3*MODEL_CONSTANTS.dualBonusBlendMax,.08,MODEL_CONSTANTS.dualBonusBlendMax);
      const newFair=fair*(1-dualBlendWeight)+dualBonus.estimate*dualBlendWeight;
      const factor=fair>0?newFair/fair:1; low*=factor;fair=newFair;high*=factor;
    }
    if(regime.available&&Math.abs(regime.appliedPct)>0.0001){const factor=1+regime.appliedPct;low*=factor;fair*=factor;high*=factor;}

    const confidenceData=calculateConfidence(weighted,{low,fair,high},pricingMode,{directCount:direct.length,bonusRangeCoverage,statSamples:statContext.sampleCount,regime,dualBonus});
    const explanation=[
      {label:'Historical anchor',value:anchorFair,detail:`${pricingMode} · ${weighted.length} weighted comps`},
      ...(dualBlendWeight>0?[{label:'Dual-bonus support',value:dualBonus.estimate,detail:`${Math.round(dualBlendWeight*100)}% blend · ${dualBonus.source}`}]:[]),
      ...(regime.available&&Math.abs(regime.appliedPct)>0.0001?[{label:'Market regime',pct:regime.appliedPct,detail:`broad ${target.rarity} market ${regime.rawPct>=0?'up':'down'} ${Math.abs(regime.rawPct*100).toFixed(1)}% recent vs older`}]:[]),
      ...bonusProfile.map(p=>({label:`${p.title} roll`,text:Number.isFinite(p.percentile)?`${Math.round(p.percentile*100)}th percentile · ${p.classCode} ${p.min}-${p.max}`:'range fallback',detail:p.source})),
    ];
    return{...shared,low,fair,high,anchorLow,anchorFair,anchorHigh,dualBlendWeight,confidence:confidenceData.total,confidenceLabel:confidenceData.label,confidenceParts:confidenceData.parts,valuationExplanation:explanation};
  }


  // ---------------------------------------------------------------------------
  // Backtest error tracking + conservative calibration
  // ---------------------------------------------------------------------------

  function calibrationRarity(target) {
    return normalizeRarity(target?.rarity).toLowerCase() || 'unknown';
  }

  function calibrationKeys(target) {
    const itemId = Math.floor(Number(target?.itemId) || 0);
    const rarity = calibrationRarity(target);
    const sig = bonusSignature(target) || 'none';
    return {
      exact: `${itemId}|${rarity}|${sig}`,
      broad: `${itemId}|${rarity}|*`,
    };
  }

  function calibrationEntryForTarget(target) {
    if (!state.settings.calibrationEnabled) return null;
    const keys = calibrationKeys(target);
    const minSamples = Math.max(3, Math.floor(Number(state.settings.calibrationMinSamples) || 6));
    const exact = state.calibrationMemory.get(keys.exact);
    if (exact?.modelId === CALIBRATION_MODEL_ID && Number(exact.n) >= minSamples) return { ...exact, level: 'exact bonus' };
    const broad = state.calibrationMemory.get(keys.broad);
    if (broad?.modelId === CALIBRATION_MODEL_ID && Number(broad.n) >= minSamples) return { ...broad, level: 'item + rarity' };
    return null;
  }

  function calibrationAdjustment(entry) {
    if (!entry || !(Number(entry.n) > 0)) return { factor: 1, pct: 0, shrink: 0 };
    const n = Number(entry.n);
    const shrink = n / (n + 12);
    const cap = Math.max(0, safeNumber(state.settings.calibrationMaxAdjustPct, 8)) / 100;
    const meanLog = Number(entry.sumLogError || 0) / n;
    const rawPct = Math.exp(meanLog * shrink) - 1;
    const pct = clamp(rawPct, -cap, cap);
    return { factor: 1 + pct, pct, shrink, rawPct };
  }

  function applyCalibrationToValuation(raw) {
    if (!raw || !Number.isFinite(raw.fair)) return { ...raw, calibration: null };
    const entry = calibrationEntryForTarget(raw.target);
    if (!entry) return { ...raw, calibration: null };
    const adj = calibrationAdjustment(entry);
    if (!Number.isFinite(adj.factor) || Math.abs(adj.pct) < 0.00001) return { ...raw, calibration: { ...entry, ...adj } };
    const n = Number(entry.n) || 0;
    const maePct = n ? Number(entry.sumAbsPct || 0) / n : 0;
    const biasPct = n ? Number(entry.sumPct || 0) / n : 0;
    let confidenceCap = 100;
    if (maePct > .30) confidenceCap = 65;
    else if (maePct > .22) confidenceCap = 75;
    else if (maePct > .16) confidenceCap = 86;
    const explanation = [...(raw.valuationExplanation || []), {
      label: 'Backtest calibration', pct: adj.pct,
      detail: `${entry.level} · ${n} held-out sales · MAE ${(maePct*100).toFixed(1)}% · raw bias ${(biasPct*100).toFixed(1)}%`,
    }];
    return {
      ...raw,
      rawLow: raw.low, rawFair: raw.fair, rawHigh: raw.high,
      low: raw.low * adj.factor, fair: raw.fair * adj.factor, high: raw.high * adj.factor,
      confidence: Math.min(Number(raw.confidence) || 0, confidenceCap),
      confidenceLabel: Math.min(Number(raw.confidence) || 0, confidenceCap) >= 80 ? 'HIGH' : Math.min(Number(raw.confidence) || 0, confidenceCap) >= 60 ? 'MEDIUM' : 'LOW',
      calibration: { ...entry, ...adj, maePct, biasPct, confidenceCap },
      valuationExplanation: explanation,
    };
  }

  function buildValuation(target, history) {
    return applyCalibrationToValuation(buildValuationRaw(target, history));
  }

  function calibrationAccumulator(seed = {}) {
    return {
      n: Number(seed.n) || 0,
      sumLogError: Number(seed.sumLogError) || 0,
      sumAbsPct: Number(seed.sumAbsPct) || 0,
      sumPct: Number(seed.sumPct) || 0,
    };
  }

  function addCalibrationObservation(map, key, target, actualPrice, predictedPrice) {
    if (!(actualPrice > 0) || !(predictedPrice > 0)) return;
    const ratio = actualPrice / predictedPrice;
    if (!Number.isFinite(ratio) || ratio < .15 || ratio > 6) return;
    const pct = ratio - 1;
    const acc = calibrationAccumulator(map.get(key));
    acc.n += 1;
    acc.sumLogError += Math.log(ratio);
    acc.sumAbsPct += Math.abs(pct);
    acc.sumPct += pct;
    acc.itemId = Number(target.itemId) || 0;
    acc.rarity = calibrationRarity(target);
    acc.bonusSig = key.endsWith('|*') ? '*' : (bonusSignature(target) || 'none');
    map.set(key, acc);
  }

  async function runCalibrationBacktest(itemId, sales, force = false) {
    itemId = Math.floor(Number(itemId));
    if (!itemId || !state.settings.calibrationEnabled || state.calibrationRunning.has(itemId)) return null;
    const sorted = [...(sales || [])].filter(s => s && Number(s.itemId) === itemId && Number(s.price) > 0 && Number(s.timestamp) > 0)
      .sort((a,b) => Number(a.timestamp) - Number(b.timestamp));
    if (sorted.length < 20) return null;
    const broadPrefix = `${itemId}|`;
    const broadExisting = [...state.calibrationMemory.values()].find(e => e?.key?.startsWith(broadPrefix) && e.key.endsWith('|*'));
    const refreshMs = Math.max(1, Number(state.settings.calibrationRefreshHours) || 24) * 3600000;
    if (!force && broadExisting?.updatedAt && Date.now() - Number(broadExisting.updatedAt) < refreshMs) return broadExisting;

    const databaseEpoch=state.databaseEpoch||0;
    state.calibrationRunning.add(itemId);
    try {
      const maxTests = Math.max(4, Math.min(30, Math.floor(Number(state.settings.calibrationBacktestPerItem) || 12)));
      const start = Math.max(14, sorted.length - Math.max(maxTests * 3, 24));
      const candidateIndices = [];
      for (let i = start; i < sorted.length && candidateIndices.length < maxTests; i++) {
        if ((i - start) % Math.max(1, Math.floor((sorted.length - start) / maxTests)) === 0 || i >= sorted.length - 3) candidateIndices.push(i);
      }
      const accum = new Map();
      let tested = 0, skipped = 0;
      for (const i of candidateIndices.slice(-maxTests)) {
        const target = sorted[i];
        const older = sorted.slice(0, i).filter(s => s.timestamp < target.timestamp);
        if (older.length < 14) { skipped += 1; continue; }
        const raw = buildValuationAt({ ...target, source: 'calibration-backtest' }, older, target.timestamp);
        if (!(raw.fair > 0) || (raw.confidence || 0) < 35 || (raw.pricingComps?.length || 0) < 2) { skipped += 1; continue; }
        const keys = calibrationKeys(target);
        addCalibrationObservation(accum, keys.exact, target, Number(target.price), Number(raw.fair));
        addCalibrationObservation(accum, keys.broad, target, Number(target.price), Number(raw.fair));
        tested += 1;
      }
      // Replace this item's calibration instead of appending duplicate backtests.
      const oldKeys = [...state.calibrationMemory.keys()].filter(key => key.startsWith(`${itemId}|`));
      for (const key of oldKeys) await deleteCalibrationEntry(key);
      const nowMs = Date.now();
      for (const [key, stats] of accum.entries()) {
        if(databaseEpoch!==(state.databaseEpoch||0)) return null;
        const entry = { key, ...stats, modelId: CALIBRATION_MODEL_ID, updatedAt: nowMs, tested, skipped };
        state.calibrationMemory.set(key, entry);
        await persistCalibrationEntry(entry);
      }
      healthBump('calibrationRuns');
      healthBump('calibrationTests', tested);
      return [...accum.values()][0] || null;
    } finally {
      state.calibrationRunning.delete(itemId);
    }
  }

  function scheduleCalibrationBacktest(itemId, sales, force = false) {
    if (!state.settings.calibrationEnabled) return;
    const epoch=state.databaseEpoch||0;
    setTimeout(()=>{
      if(epoch!==(state.databaseEpoch||0)) return;
      runCalibrationBacktest(itemId,sales,force).then(()=>{
        if(document.getElementById(rootId)?.dataset.open==='1') renderPanel();
      }).catch(error=>{state.dbError=cleanApiErrorMessage(error);});
    },0);
  }

  function modelCalibrationStats() {
    const broad = [...state.calibrationMemory.values()].filter(e => e?.modelId === CALIBRATION_MODEL_ID && String(e.key || '').endsWith('|*') && Number(e.n) > 0);
    const samples = broad.reduce((s,e) => s + Number(e.n || 0), 0);
    const sumAbs = broad.reduce((s,e) => s + Number(e.sumAbsPct || 0), 0);
    const sumPct = broad.reduce((s,e) => s + Number(e.sumPct || 0), 0);
    const weightedAdjust = broad.reduce((s,e) => {
      const a = calibrationAdjustment(e);
      return s + a.pct * Number(e.n || 0);
    }, 0);
    return {
      segments: state.calibrationMemory.size,
      broadSegments: broad.length,
      samples,
      maePct: samples ? sumAbs / samples : 0,
      biasPct: samples ? sumPct / samples : 0,
      averageAppliedPct: samples ? weightedAdjust / samples : 0,
      running: state.calibrationRunning.size,
    };
  }

  async function recalibrateEntireDatabase() {
    await ensureRwDatabaseReady();
    const entries = [...state.historyMemory.entries()];
    if (state.dbMode !== 'indexeddb') {
      for (const itemId of Object.keys(historyIndexGet())) {
        const bundle = loadPersistentHistory(Number(itemId));
        if (bundle && !entries.some(([id]) => Number(id) === Number(itemId))) entries.push([Number(itemId), bundle]);
      }
    }
    let done = 0;
    for (const [itemId, bundle] of entries) {
      setStatus(`Calibration backtest ${done + 1}/${entries.length}: item ${itemId}…`);
      await runCalibrationBacktest(itemId, bundle?.sales || [], true);
      done += 1;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return done;
  }

  function calculateConfidence(comps, valuation, pricingMode='', calibration={}) {
    const top=comps.slice(0,10), avgMatch=top.reduce((s,c)=>s+c.matchScore,0)/Math.max(1,top.length);
    const similarityPoints=clamp(avgMatch/100,0,1)*36;
    const directCount=comps.filter(c=>c.tier==='DIRECT').length, strongCount=comps.filter(c=>c.tier==='STRONG').length, baseCount=comps.filter(c=>c.tier==='BASE').length;
    const sumW=comps.reduce((s,c)=>s+Math.max(0,c.weight||0),0), sumW2=comps.reduce((s,c)=>s+Math.pow(Math.max(0,c.weight||0),2),0);
    const effectiveN=sumW2>0?sumW*sumW/sumW2:0;
    const quantityPoints=clamp((effectiveN + .5*directCount + .12*strongCount)/10,0,1)*20;
    const spreadRatio=valuation.fair>0?Math.max(0,valuation.high-valuation.low)/valuation.fair:1;
    const dispersionPoints=clamp(1-spreadRatio/.65,0,1)*20;
    const avgRecencyFraction=top.reduce((s,c)=>s+c.breakdown.recency/5,0)/Math.max(1,top.length), recencyPoints=clamp(avgRecencyFraction,0,1)*10;
    const directShare=comps.length?directCount/comps.length:0, exactnessPoints=directShare*10;
    const modelQualityPoints=4*clamp((safeNumber(calibration.bonusRangeCoverage,0)+clamp(safeNumber(calibration.statSamples,0)/12,0,1))/2,0,1);

    let modeMultiplier=1;
    if(pricingMode==='direct + strong')modeMultiplier=.96; else if(pricingMode==='strong')modeMultiplier=.82; else if(pricingMode==='base fallback')modeMultiplier=.55; else if(pricingMode==='insufficient')modeMultiplier=.45;
    const raw=similarityPoints+quantityPoints+dispersionPoints+recencyPoints+exactnessPoints+modelQualityPoints;
    let total=Math.round(clamp(raw*modeMultiplier,0,100));
    let confidenceCap=100;
    const rawDirect=safeNumber(calibration.directCount,directCount);
    if(rawDirect===0)confidenceCap=Math.min(confidenceCap,76);
    else if(rawDirect<3)confidenceCap=Math.min(confidenceCap,89);
    if(effectiveN<2.2)confidenceCap=Math.min(confidenceCap,72);
    if(avgMatch<70)confidenceCap=Math.min(confidenceCap,78);
    if(spreadRatio>.60)confidenceCap=Math.min(confidenceCap,82);
    if(pricingMode==='base fallback')confidenceCap=Math.min(confidenceCap,62);
    total=Math.min(total,confidenceCap);
    return{total,label:total>=80?'HIGH':total>=60?'MEDIUM':'LOW',parts:{similarity:Math.round(similarityPoints),quantity:Math.round(quantityPoints),dispersion:Math.round(dispersionPoints),recency:Math.round(recencyPoints),exactness:Math.round(exactnessPoints),modelQuality:Math.round(modelQualityPoints),avgMatch:Math.round(avgMatch),spreadRatio,pricingMode,modeMultiplier,effectiveN:Math.round(effectiveN*10)/10,confidenceCap,bonusRangeCoverage:safeNumber(calibration.bonusRangeCoverage,0),statSamples:safeNumber(calibration.statSamples,0)}};
  }

  function addDealMetrics(valuation) {
    const ask = valuation.target.price;
    const fee = clamp(state.settings.marketFeePct / 100, 0, 0.25);
    if (!Number.isFinite(valuation.low) || !Number.isFinite(ask) || ask <= 0) {
      return {
        ...valuation,
        netConservative: null,
        conservativeProfit: null,
        conservativeEdgePct: null,
        dealScore: 0,
        dealLabel: 'NO PRICE',
      };
    }

    const netConservative = valuation.low * (1 - fee);
    const conservativeProfit = netConservative - ask;
    const conservativeEdgePct = conservativeProfit / ask;

    const edgeScore = clamp(conservativeEdgePct / 0.25, 0, 1) * 100;
    const liquidityScore = clamp(safeNumber(valuation.liquidity?.score, 0), 0, 100);
    let dealScore = Math.round(0.50 * edgeScore + 0.30 * valuation.confidence + 0.20 * liquidityScore);
    if (valuation.confidence < 50) dealScore = Math.min(dealScore, 59);
    if (conservativeProfit <= 0) dealScore = Math.min(dealScore, 35);

    let dealLabel = 'NO EDGE';
    if (conservativeProfit > 0 && valuation.confidence < 50) dealLabel = '⚠ POSSIBLE';
    else if (dealScore >= 75 && valuation.confidence >= 70) dealLabel = liquidityScore < 30 ? '🔥 VALUE · SLOW' : '🔥 STRONG STEAL';
    else if (dealScore >= 55 && valuation.confidence >= 55) dealLabel = liquidityScore < 25 ? '🟡 VALUE · SLOW' : '🟢 UNDERPRICED';
    else if (conservativeProfit > 0) dealLabel = '🟡 CHECK';

    const expectedDays = safeNumber(valuation.liquidity?.expectedDays, 180);
    const profitVelocity30d = conservativeProfit > 0 && expectedDays > 0 ? conservativeProfit * clamp(30 / expectedDays, 0, 6) : conservativeProfit;

    return {
      ...valuation,
      netConservative,
      conservativeProfit,
      conservativeEdgePct,
      profitVelocity30d,
      dealScore,
      dealLabel,
    };
  }


  function calculateBuyCeilings(valuation) {
    const fee = clamp(state.settings.marketFeePct / 100, 0, 0.25);
    if (!Number.isFinite(valuation.low)) return { conservativeNet: null, goodMax: null, absoluteMax: null };
    const conservativeNet = valuation.low * (1 - fee);
    const preferredRoi = clamp(state.settings.auctionTargetRoiPct / 100, 0, 5);
    const preferredProfit = Math.max(0, safeNumber(state.settings.auctionMinProfit, 0));
    const preferredSafety = clamp(state.settings.auctionSafetyPct / 100, 0, 0.5);
    const absoluteRoi = clamp(state.settings.auctionAbsoluteRoiPct / 100, 0, 5);
    const absoluteProfit = Math.max(0, safeNumber(state.settings.auctionAbsoluteMinProfit, 0));
    const absoluteSafety = clamp(state.settings.auctionAbsoluteSafetyPct / 100, 0, 0.5);

    const preferredByRoi = preferredRoi > 0 ? conservativeNet / (1 + preferredRoi) : conservativeNet;
    const preferredByProfit = conservativeNet - preferredProfit;
    const absoluteByRoi = absoluteRoi > 0 ? conservativeNet / (1 + absoluteRoi) : conservativeNet;
    const absoluteByProfit = conservativeNet - absoluteProfit;
    let goodMax = Math.floor(Math.max(0, Math.min(preferredByRoi, preferredByProfit)) * (1 - preferredSafety));
    let absoluteMax = Math.floor(Math.max(0, Math.min(absoluteByRoi, absoluteByProfit)) * (1 - absoluteSafety));
    absoluteMax = Math.max(goodMax, absoluteMax);
    if (valuation.confidence < clamp(state.settings.auctionMinConfidence, 0, 100)) {
      goodMax = null;
      absoluteMax = null;
    }
    return { conservativeNet, goodMax, absoluteMax };
  }

  function addMarketBuyMetrics(valuation) {
    const target = valuation.target;
    if (target?.source !== 'market') return valuation;
    const ask = safeNumber(target.price);
    const ceilings = calculateBuyCeilings(valuation);
    if (!Number.isFinite(ask) || !Number.isFinite(ceilings.conservativeNet)) {
      return { ...valuation, recommendedMaxBuy: null, absoluteMaxBuy: null, buyHeadroom: null, absoluteBuyHeadroom: null, buyProfitAtMax: null, marketBuyable: false, marketAbsoluteBuyable: false };
    }
    const recommendedMaxBuy = ceilings.goodMax;
    const absoluteMaxBuy = ceilings.absoluteMax;
    const buyHeadroom = Number.isFinite(recommendedMaxBuy) ? recommendedMaxBuy - ask : null;
    const absoluteBuyHeadroom = Number.isFinite(absoluteMaxBuy) ? absoluteMaxBuy - ask : null;
    const buyProfitAtMax = Number.isFinite(recommendedMaxBuy) ? ceilings.conservativeNet - recommendedMaxBuy : null;
    const absoluteBuyProfitAtMax = Number.isFinite(absoluteMaxBuy) ? ceilings.conservativeNet - absoluteMaxBuy : null;
    return {
      ...valuation,
      recommendedMaxBuy,
      absoluteMaxBuy,
      buyHeadroom,
      absoluteBuyHeadroom,
      buyProfitAtMax,
      absoluteBuyProfitAtMax,
      marketBuyable: Number.isFinite(recommendedMaxBuy) && ask <= recommendedMaxBuy,
      marketAbsoluteBuyable: Number.isFinite(absoluteMaxBuy) && ask <= absoluteMaxBuy,
    };
  }

  function addAuctionBidMetrics(valuation) {
    const target = valuation.target;
    if (target?.source !== 'auction-live') return valuation;

    const currentBid = safeNumber(target.currentBid ?? target.price);
    const minLegalBid = Number.isFinite(currentBid) ? Math.max(1, Math.ceil(currentBid * 1.01)) : null;
    const ceilings = calculateBuyCeilings(valuation);
    const minConfidence = clamp(state.settings.auctionMinConfidence, 0, 100);
    const confidenceOk = valuation.confidence >= minConfidence;

    if (!Number.isFinite(ceilings.conservativeNet) || !Number.isFinite(currentBid)) {
      return {
        ...valuation,
        minLegalBid,
        recommendedMaxBid: null,
        absoluteMaxBid: null,
        auctionProfitNow: null,
        auctionProfitAtMax: null,
        auctionProfitAtAbsoluteMax: null,
        auctionHeadroom: null,
        auctionAbsoluteHeadroom: null,
        auctionHeadroomPct: null,
        auctionBiddable: false,
        auctionAbsoluteBiddable: false,
        auctionBidLabel: 'INSUFFICIENT DATA',
      };
    }

    const recommendedMaxBid = ceilings.goodMax;
    const absoluteMaxBid = ceilings.absoluteMax;
    const auctionProfitNow = ceilings.conservativeNet - currentBid;
    const auctionProfitAtMax = Number.isFinite(recommendedMaxBid) ? ceilings.conservativeNet - recommendedMaxBid : null;
    const auctionProfitAtAbsoluteMax = Number.isFinite(absoluteMaxBid) ? ceilings.conservativeNet - absoluteMaxBid : null;
    const auctionHeadroom = Number.isFinite(recommendedMaxBid) ? recommendedMaxBid - currentBid : null;
    const auctionAbsoluteHeadroom = Number.isFinite(absoluteMaxBid) ? absoluteMaxBid - currentBid : null;
    const auctionHeadroomPct = Number.isFinite(auctionHeadroom) && currentBid > 0 ? auctionHeadroom / currentBid : null;
    const auctionBiddable = Boolean(confidenceOk && Number.isFinite(recommendedMaxBid) && Number.isFinite(minLegalBid) && minLegalBid <= recommendedMaxBid);
    const auctionAbsoluteBiddable = Boolean(confidenceOk && Number.isFinite(absoluteMaxBid) && Number.isFinite(minLegalBid) && minLegalBid <= absoluteMaxBid);

    let auctionBidLabel = 'PASS';
    if (!confidenceOk) auctionBidLabel = '⚠ LOW CONFIDENCE';
    else if (auctionBiddable && valuation.dealScore >= 75) auctionBidLabel = '🔥 GOOD BUY';
    else if (auctionBiddable) auctionBidLabel = '🟢 GOOD BUY';
    else if (auctionAbsoluteBiddable) auctionBidLabel = '🟡 ABSOLUTE ROOM';
    else if (auctionProfitNow > 0) auctionBidLabel = '🟠 TOO CLOSE';

    return {
      ...valuation,
      minLegalBid,
      recommendedMaxBid,
      absoluteMaxBid,
      auctionProfitNow,
      auctionProfitAtMax,
      auctionProfitAtAbsoluteMax,
      auctionHeadroom,
      auctionAbsoluteHeadroom,
      auctionHeadroomPct,
      auctionBiddable,
      auctionAbsoluteBiddable,
      auctionBidLabel,
    };
  }

  function compQualitySummary(result) {
    return `${result.directCount ?? 0}D/${result.strongCount ?? 0}S/${result.baseCount ?? 0}B`;
  }

  function applyOpportunityDecision(valuation) {
    if (!valuation || valuation.error) return valuation;
    const source = valuation.target?.source;
    const entryPrice = source === 'auction-live'
      ? safeNumber(valuation.minLegalBid)
      : safeNumber(valuation.target?.price);
    const profitNow = Number.isFinite(valuation.netConservative) && Number.isFinite(entryPrice)
      ? valuation.netConservative - entryPrice : null;
    const roiNow = Number.isFinite(profitNow) && entryPrice > 0 ? profitNow / entryPrice : null;
    const capitalEfficiency = Number.isFinite(profitNow) && entryPrice > 0 ? profitNow / entryPrice * 100000000 : null;
    const actionPrice = source === 'auction-live' ? safeNumber(valuation.minLegalBid, entryPrice) : entryPrice;

    const hardReasons = [];
    const minProfit = Math.max(0, Number(state.settings.highlightMinProfit) || 0);
    const minRoi = Math.max(0, Number(state.settings.highlightMinRoiPct) || 0) / 100;
    const minConfidence = clamp(Number(state.settings.highlightMinConfidence) || 0, 0, 100);
    const minLiquidity = clamp(Number(state.settings.highlightMinLiquidity) || 0, 0, 100);
    const maxCapital = Math.max(0, Number(state.settings.highlightMaxCapital) || 0);
    if (valuation.confidence < minConfidence) hardReasons.push(`confidence ${valuation.confidence} < ${minConfidence}`);
    if ((valuation.liquidity?.score ?? 0) < minLiquidity) hardReasons.push(`liquidity ${valuation.liquidity?.score ?? 0} < ${minLiquidity}`);
    if (state.settings.highlightDirectOnly && (valuation.directCount ?? 0) < 1) hardReasons.push('no DIRECT comparable sales');
    if (maxCapital > 0 && Number.isFinite(actionPrice) && actionPrice > maxCapital) hardReasons.push(`capital ${fmtMoney(actionPrice)} > ${fmtMoney(maxCapital)}`);
    if (!Number.isFinite(profitNow)) hardReasons.push('profit unavailable');
    else if (profitNow < minProfit) hardReasons.push(`profit ${fmtMoney(profitNow)} < ${fmtMoney(minProfit)}`);
    if (!Number.isFinite(roiNow)) hardReasons.push('ROI unavailable');
    else if (roiNow < minRoi) hardReasons.push(`ROI ${fmtPct(roiNow)} < ${(minRoi*100).toFixed(1)}%`);

    let opportunityClass = 'PASS';
    const actionReasons = [...hardReasons];
    if (!hardReasons.length) {
      if (source === 'auction-live') {
        if (valuation.auctionBiddable) {
          const strong = valuation.dealScore >= 78 && valuation.confidence >= 75 && (valuation.liquidity?.score ?? 0) >= 45 && (valuation.directCount ?? 0) >= 3;
          opportunityClass = strong ? 'STRONG BUY' : 'GOOD BUY';
        } else if (valuation.auctionAbsoluteBiddable) opportunityClass = 'WATCH';
        else if (Number.isFinite(profitNow) && profitNow > 0) {
          opportunityClass = 'MARGINAL';
          actionReasons.push('next legal bid exceeds absolute ceiling');
        } else {
          opportunityClass = 'PASS';
          actionReasons.push('no conservative edge at current bid');
        }
      } else if (source === 'market') {
        if (valuation.marketBuyable) {
          const strong = valuation.dealScore >= 78 && valuation.confidence >= 75 && (valuation.liquidity?.score ?? 0) >= 45 && (valuation.directCount ?? 0) >= 3;
          opportunityClass = strong ? 'STRONG BUY' : 'GOOD BUY';
        } else if (valuation.marketAbsoluteBuyable) opportunityClass = 'WATCH';
        else if (Number.isFinite(profitNow) && profitNow > 0) {
          opportunityClass = 'MARGINAL';
          actionReasons.push('price exceeds absolute buy ceiling');
        } else {
          opportunityClass = 'PASS';
          actionReasons.push('no conservative edge at asking price');
        }
      }
    }
    const opportunityRank = { 'STRONG BUY': 5, 'GOOD BUY': 4, 'WATCH': 3, 'MARGINAL': 2, 'PASS': 1 }[opportunityClass] || 0;
    return {
      ...valuation,
      profitNow,
      roiNow,
      capitalEfficiency,
      passesSniperFilters: hardReasons.length === 0,
      opportunityClass,
      opportunityRank,
      rejectReasons: actionReasons,
      compSummary: compQualitySummary(valuation),
    };
  }

  function auctionResultSort(a, b) {
    if (a.error && !b.error) return 1;
    if (!a.error && b.error) return -1;
    if (a.error && b.error) return 0;
    const aUrgent = Number(a.opportunityRank >= 3 && Number.isFinite(a.target?.remainingSeconds) && a.target.remainingSeconds <= state.settings.endingSoonMinutes * 60);
    const bUrgent = Number(b.opportunityRank >= 3 && Number.isFinite(b.target?.remainingSeconds) && b.target.remainingSeconds <= state.settings.endingSoonMinutes * 60);
    return (Number(b.opportunityRank) - Number(a.opportunityRank))
      || (bUrgent - aUrgent)
      || ((b.dealScore ?? 0) - (a.dealScore ?? 0))
      || ((b.profitNow ?? -Infinity) - (a.profitNow ?? -Infinity))
      || ((a.target?.remainingSeconds ?? Infinity) - (b.target?.remainingSeconds ?? Infinity))
      || ((b.confidence ?? 0) - (a.confidence ?? 0));
  }

  async function scanVisibleAuctionHouse({ forceHistory = false, automatic = false } = {}) {
    host.assertReady();
    await ensureRwDatabaseReady();
    const unavailable = message => {
      if (automatic) { setStatus(`Auto AH: ${message}`); return false; }
      alert(message); return false;
    };
    if (state.busy) { if (automatic) state.autoAuctionPending = true; return false; }
    if (!location.href.includes('amarket.php')) return unavailable('Open Torn Auction House first. RW Scout only reads live auctions from the page you have actually opened.');
    if (!isActiveVisiblePage()) return unavailable('Keep the Auction House tab visible and focused, then run the scan again.');
    if (!getApiKey()) return unavailable('RW Scout needs a Torn API key for completed-auction history.');

    let targets = getVisibleAuctionTargets();
    const pageSignature = buildAuctionPageSignature(targets);
    if (!targets.length) return unavailable('No Auction House equipment rows were detected in the currently visible tab.');

    state.busy = true;
    const generation = ++state.auctionScanGeneration;
    state.lastResults = [];
    renderPanel();

    try {
      // UID details are cached separately. After the first sighting of a UID,
      // repeat pages usually avoid this network request entirely.
      let detailStats = { cacheHits: 0, fetched: 0, requested: targets.length };
      try {
        const detailResult = await fetchItemDetailsByUids(targets.map(t => t.uid));
        detailStats = detailResult;
        targets = targets.map(t => enrichLiveAuctionTarget(t, detailResult.map.get(String(t.uid))));
      } catch (detailError) {
        if(detailError.cancelled) throw detailError;
        setStatus(`Exact UID detail lookup failed: ${cleanApiErrorMessage(detailError)}`);
      }

      targets = targets.filter(t => t.detailsResolved && isRankedWarItem(t));
      if (!targets.length) throw new Error('Visible auction rows were found, but none resolved to Ranked War equipment with authoritative rarity/bonus data.');

      const signature = pageSignature;
      if(signature!==buildAuctionPageSignature()) {state.autoAuctionPending=true;return false;}
      const uniqueIds = [...new Set(targets.map(t => t.itemId))];
      const historyByItem = new Map();
      let localReady = 0;
      for (const itemId of uniqueIds) {
        const local = loadInstantHistory(itemId);
        if (local) { historyByItem.set(itemId, local); localReady += 1; }
      }

      const staleIds = uniqueIds.filter(id => historyNeedsRefresh(historyByItem.get(id), forceHistory));
      state.historyRefreshingIds = new Set(staleIds);

      const buildResults = () => targets.map(target => {
        const historyBundle = historyByItem.get(target.itemId) || { sales: [], audit: { requestedItemId: target.itemId, syncMode: 'no local DB', pagesFetched: 0, databaseSales: 0 } };
        const audit = historyBundle.audit || historyAuditFromBundle(historyBundle);
        const valued = applyOpportunityDecision(addAuctionBidMetrics(addDealMetrics(buildValuation(target, historyBundle.sales || []))));
        return {
          ...valued,
          historyAudit: audit,
          historyFreshness: freshnessInfo(audit, state.historyRefreshingIds.has(target.itemId)),
          historyError: historyBundle.error || '',
        };
      }).sort(auctionResultSort);

      // Phase 1: show local valuations immediately. No history network request is
      // allowed to hold up this first render.
      state.lastResults = buildResults();
      annotateAuctionRows(state.lastResults);
      renderPanel();

      const instantValued = state.lastResults.filter(r => Number.isFinite(r.fair)).length;
      setStatus(`Local-first: ${instantValued}/${targets.length} listings valued immediately from ${localReady}/${uniqueIds.length} cached item histories · UID cache ${detailStats.cacheHits}/${detailStats.requested}. ${staleIds.length ? `Refreshing ${staleIds.length} stale/missing histories…` : 'No history refresh needed.'}`);

      // Phase 2: refresh only stale/missing item histories. Recalculate affected
      // rows after each item so fresh data appears progressively rather than at
      // the end of a long multi-item page.
      for (let i = 0; i < staleIds.length; i++) {
        const itemId = staleIds[i];
        setStatus(`Background history sync ${i + 1}/${staleIds.length}: item ${itemId}…`);
        try {
          const history = await fetchAuctionHistory(itemId, { force: forceHistory });
          historyByItem.set(itemId, history);
        } catch (err) {
          if(err.cancelled) throw err;
          const local = historyByItem.get(itemId);
          if (local?.sales?.length) {
            historyByItem.set(itemId, { ...local, stale: true, error: cleanApiErrorMessage(err) });
          } else {
            historyByItem.set(itemId, { sales: [], audit: { requestedItemId: itemId, syncMode: 'sync failed', pagesFetched: 0, databaseSales: 0 }, error: cleanApiErrorMessage(err) });
          }
        }

        // If the user has paged away, do not paint old results onto the new page.
        if (generation !== state.auctionScanGeneration || (signature && buildAuctionPageSignature() !== signature)) {
          state.autoAuctionPending = true;
          return false;
        }
        state.historyRefreshingIds.delete(itemId);
        state.lastResults = buildResults();
        annotateAuctionRows(state.lastResults);
        renderPanel();
      }

      // Phase 3: current Item Market asks are a sanity check only. They never
      // replace completed-sale valuation and are fetched after local/history
      // pricing has already been displayed.
      if (state.settings.marketSanityEnabled && generation === state.auctionScanGeneration) {
        for (let i = 0; i < uniqueIds.length; i++) {
          const itemId = uniqueIds[i];
          try {
            setStatus(`Current-market check ${i + 1}/${uniqueIds.length}: item ${itemId}…`);
            const snapshot = await getCurrentMarketSnapshot(itemId);
            if(signature!==buildAuctionPageSignature()) {state.autoAuctionPending=true;return false;}
            state.lastResults = state.lastResults.map(result => {
              if (result?.target?.itemId !== itemId || result.error) return result;
              return { ...result, marketSanity: buildMarketSanity(result.target, snapshot?.listings || [], result.fair), marketSanityCached: !!snapshot?.cached };
            }).sort(auctionResultSort);
            annotateAuctionRows(state.lastResults);
            renderPanel();
          } catch (marketError) {
            if(marketError.cancelled) throw marketError;
            state.lastResults = state.lastResults.map(result => result?.target?.itemId === itemId ? { ...result, marketSanityError: cleanApiErrorMessage(marketError) } : result);
          }
        }
      }
      state.historyRefreshingIds.clear();

      const viable = state.lastResults.filter(r => ['STRONG BUY','GOOD BUY'].includes(r.opportunityClass)).length;
      const watch = state.lastResults.filter(r => r.opportunityClass === 'WATCH').length;
      if (signature) state.autoAuctionLastSignature = signature;
      setStatus(`${automatic ? 'Auto AH' : 'Auction'} scan ready. ${state.lastResults.length} RW listings · ${viable} good/strong · ${watch} watch.`);
      return true;
    } finally {
      state.busy = false;
      renderPanel();
      if (state.autoAuctionPending && state.settings.autoAuctionSniper) {
        state.autoAuctionPending = false;
        scheduleAutoAuctionScan('queued page change', 250);
      }
    }
  }

  function buildAuctionPageSignature(targets = null) {
    const rows = Array.isArray(targets) ? targets : getVisibleAuctionTargets();
    if (!rows.length) return '';
    // Ignore countdown timers and current bids. We want one scan when the actual
    // rendered auction page changes, not every second as Torn updates timers.
    return rows
      .map(t => `${String(t.uid || '')}:${String(t.rowKey || '').split(':').slice(0, 2).join(':')}`)
      .filter(Boolean)
      .sort()
      .join('|');
  }

  function cancelAutoAuctionTimer() {
    if (state.autoAuctionTimer) clearTimeout(state.autoAuctionTimer);
    state.autoAuctionTimer = null;
    state.autoAuctionPending = false;
  }

  function scheduleAutoAuctionScan(reason = 'page change', delay = 1100) {
    if (!state.settings.autoAuctionSniper) return;
    if (!location.href.includes('amarket.php')) { document.getElementById('rws-ah-summary')?.remove(); return; }
    clearTimeout(state.autoAuctionTimer);
    state.autoAuctionTimer = setTimeout(async () => {
      state.autoAuctionTimer = null;
      if (!host.ready() || !state.settings.autoAuctionSniper || !location.href.includes('amarket.php')) return;
      if (!isActiveVisiblePage()) return;

      const targets = getVisibleAuctionTargets();
      if (!targets.length) return;
      const signature = buildAuctionPageSignature(targets);
      if (!signature || signature === state.autoAuctionLastSignature) return;

      if (state.busy) {
        state.autoAuctionPending = true;
        return;
      }

      setStatus(`Auto AH: detected ${targets.length} rendered listings (${reason}); analyzing…`);
      try {
        await scanVisibleAuctionHouse({ forceHistory: false, automatic: true });
      } catch (error) {
        setStatus(`Auto AH error: ${cleanApiErrorMessage(error)}`);
      }
    }, Math.max(150, Number(delay) || 1100));
  }

  function refreshAuctionBidsOnly() {
    if (!location.href.includes('amarket.php')) return;
    if (!state.lastResults.some(r => r?.target?.source === 'auction-live')) return;
    const live = getVisibleAuctionTargets();
    if (!live.length) return;
    const byUid = new Map(live.map(t => [String(t.uid), t]));
    let changed = false;
    state.lastResults = state.lastResults.map(result => {
      if (result?.target?.source !== 'auction-live') return result;
      const latest = byUid.get(String(result.target.uid));
      if (!latest || !Number.isFinite(latest.currentBid)) return result;
      if (latest.currentBid === result.target.currentBid && latest.remainingSeconds === result.target.remainingSeconds && latest.rowKey === result.target.rowKey) return result;
      changed = true;
      const target = {
        ...result.target,
        currentBid: latest.currentBid,
        price: latest.currentBid,
        remainingSeconds: latest.remainingSeconds,
        endTitle: latest.endTitle,
        rowKey: latest.rowKey,
        rowId: latest.rowId,
        isWinning: latest.isWinning,
        isOutbid: latest.isOutbid,
      };
      return applyOpportunityDecision(addAuctionBidMetrics(addDealMetrics({ ...result, target })));
    }).sort(auctionResultSort);
    if (!changed) return;
    annotateAuctionRows(state.lastResults);
    renderPanel();
  }

  function scheduleAuctionBidOnlyRefresh(delay = 220) {
    if (!state.settings.autoAuctionSniper) return;
    clearTimeout(state.autoBidRefreshTimer);
    state.autoBidRefreshTimer = setTimeout(() => {
      state.autoBidRefreshTimer = null;
      try { refreshAuctionBidsOnly(); } catch (_) {}
    }, Math.max(100, Number(delay) || 220));
  }

  function startAutoAuctionObserver() {
    if (state.autoAuctionObserver || !document.body) return;
    state.autoAuctionObserver = new MutationObserver(records => {
      if (!host.ready() || !state.settings.autoAuctionSniper || !location.href.includes('amarket.php')) return;
      // Ignore mutations caused solely by our own inline result badges.
      const meaningful = records.some(record => {
        const target = record.target?.nodeType === 1 ? record.target : record.target?.parentElement;
        if (!target) return true;
        if (target.closest?.('.rws-ah-inline, #umw-debug-panel')) return false;
        if (target.closest?.('.c-bid-wrap')) {
          // Bid changes do not need another history/API scan. Recalculate the
          // next bid and ceilings from the already-valued local result instead.
          scheduleAuctionBidOnlyRefresh();
          return false;
        }
        // Countdown ticks also do not trigger a history scan.
        if (target.closest?.('.time, [timer]')) return false;
        return true;
      });
      if (meaningful) scheduleAutoAuctionScan('auction page updated', 700);
    });
    state.autoAuctionObserver.observe(document.body, { childList: true, subtree: true });

    const handleAuctionNavigation = () => {
      if (!location.href.includes('amarket.php')) document.getElementById('rws-ah-summary')?.remove();
      scheduleAutoAuctionScan('navigation', 500);
    };
    window.addEventListener('hashchange', handleAuctionNavigation);
    window.addEventListener('popstate', handleAuctionNavigation);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) scheduleAutoAuctionScan('page visible', 450);
    });

    if (state.settings.autoAuctionSniper) scheduleAutoAuctionScan('initial page', 650);
  }

  function opportunityCssClass(name) {
    return String(name || '').toLowerCase().replace(/\s+/g, '-');
  }

  function updateAuctionSummaryBar() { document.getElementById('rws-ah-summary')?.remove(); }

  function annotateAuctionRows(results) {
    document.querySelectorAll('.rws-ah-inline').forEach(el => el.remove());
    for (let idx = 0; idx < results.length; idx++) {
      const r = results[idx];
      const row = state.auctionRowByKey.get(r.target?.rowKey);
      if (!row) continue;
      const host = row.querySelector(AH.title) || row.querySelector(AH.currentBid) || row;
      const badge = document.createElement('div');
      badge.className = `rws-ah-inline ${opportunityCssClass(r.opportunityClass)}`;
      const good = Number.isFinite(r.recommendedMaxBid) ? fmtMoney(r.recommendedMaxBid) : '—';
      const profit = Number.isFinite(r.profitNow) ? fmtMoney(r.profitNow) : '—';
      const roi = Number.isFinite(r.roiNow) ? fmtPct(r.roiNow, 0) : '—';
      badge.innerHTML = `<span class="state">${escapeHtml(r.opportunityClass || 'PASS')}</span><span>${profit} · ${roi}</span><span class="sub">Good ${good} · C${r.confidence} L${r.liquidity?.score ?? 0} · ${escapeHtml(r.compSummary || compQualitySummary(r))}</span>`;
      const trend = r.trend?.label && r.trend.label !== 'UNKNOWN' ? ` · ${r.trend.label}` : '';
      const market = r.marketSanity?.available ? ` · current asks ${fmtMoney(r.marketSanity.median)} (${fmtPct(r.marketSanity.vsHistoryPct)})` : '';
      const reasons = r.rejectReasons?.length ? ` · ${r.rejectReasons.join('; ')}` : '';
      badge.title = `${r.opportunityClass}. ${r.pricingMode || 'unknown'} pricing · ${r.historyFreshness?.label || 'history'} · liquidity ${r.liquidity?.label || 'unknown'}${trend}${market}${reasons}. Tap for details. No bid is placed automatically.`;
      badge.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        state.uiView = 'sniper';
        state.expandedKey = `AH:${r.target?.rowKey || `${r.target?.itemId}:${r.target?.uid}:${idx}`}`;
        togglePanel(true);
      });
      host.appendChild(badge);
    }
    updateAuctionSummaryBar(results);
  }

  // ---------------------------------------------------------------------------
  // Scanner
  // ---------------------------------------------------------------------------

  async function scanOneItem(itemId, { forceHistory = false } = {}) {
    setStatus(`Loading market for item ${itemId}…`);
    const market = await fetchItemMarket(itemId);
    const parent = market.item || { id: itemId, name: `Item ${itemId}` };
    const rwListings = asArray(market.listings)
      .map(l => normalizeMarketListing(parent, l))
      .filter(isRankedWarItem)
      .slice(0, state.settings.maxListingsPerItem);

    // Avoid spending an Auction House history request on ordinary/non-RW items.
    if (!rwListings.length) {
      return {
        itemId,
        itemName: String(parent?.name || `Item ${itemId}`),
        cacheTimestamp: safeNumber(market.cache_timestamp),
        cacheDelay: safeNumber(market.cache_delay),
        historyCached: false,
        results: [],
      };
    }

    const instant=loadInstantHistory(itemId);
    if(instant?.sales?.length) {
      const audit=instant.audit||historyAuditFromBundle(instant);
      const previews=rwListings.map(target=>({
        ...applyOpportunityDecision(addMarketBuyMetrics(addDealMetrics(buildValuation(target,instant.sales)))),
        historyAudit:audit,historyFreshness:freshnessInfo(audit,historyNeedsRefresh(instant,forceHistory)),
      }));
      state.lastResults=[...state.lastResults.filter(r=>r.target?.itemId!==itemId),...previews].sort(sortResults);
      renderPanel();
    }
    const historyBundle = await fetchAuctionHistory(itemId, { force: forceHistory });
    const audit = historyBundle.audit || historyAuditFromBundle(historyBundle);
    const results = rwListings.map(target => {
      const valued = applyOpportunityDecision(addMarketBuyMetrics(addDealMetrics(buildValuation(target, historyBundle.sales))));
      return {
        ...valued,
        historyAudit: audit,
        historyFreshness: freshnessInfo(audit, false),
        marketSanity: state.settings.marketSanityEnabled ? buildMarketSanity(target, rwListings, valued.fair) : null,
      };
    });

    return {
      itemId,
      itemName: String(parent?.name || `Item ${itemId}`),
      cacheTimestamp: safeNumber(market.cache_timestamp),
      cacheDelay: safeNumber(market.cache_delay),
      historyCached: historyBundle.cached,
      historyAudit: historyBundle.audit || historyAuditFromBundle(historyBundle),
      results,
    };
  }

  async function scanWatchlist({ forceHistory = false } = {}) {
    host.assertReady();
    await ensureRwDatabaseReady();
    if (state.busy) return;
    if (!getApiKey()) {
      alert('RW Scout needs a Torn API key first. Open Settings in the panel and save it.');
      return;
    }
    if (!state.watchlist.length) {
      alert('Add at least one Torn item ID to the watchlist.');
      return;
    }

    state.busy = true;
    state.lastResults = [];
    renderPanel();

    const combined = [];
    try {
      for (let i = 0; i < state.watchlist.length; i++) {
        const id = state.watchlist[i];
        setStatus(`Scanning ${i + 1}/${state.watchlist.length}: item ${id}…`);
        try {
          const bundle = await scanOneItem(id, { forceHistory });
          combined.push(...bundle.results.map(r => ({ ...r, marketMeta: bundle })));
        } catch (err) {
          if (err.cancelled) throw err;
          combined.push({ error: true, itemId: id, message: err.message });
        }
        state.lastResults = [...combined].sort(sortResults);
        renderPanel();
      }
      setStatus(`Scan complete. ${combined.filter(r => !r.error).length} RW listings evaluated.`);
    } finally {
      state.busy = false;
      state.lastResults = [...combined].sort(sortResults);
      renderPanel();
      if (state.autoAuctionPending && state.settings.autoAuctionSniper) {
        state.autoAuctionPending = false;
        scheduleAutoAuctionScan('queued after market scan', 350);
      }
    }
  }


  // ---------------------------------------------------------------------------
  // RW database backup / restore
  // ---------------------------------------------------------------------------

  function triggerJsonDownload(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  async function exportRwDatabase() {
    await ensureRwDatabaseReady();
    const histories = [];
    const index = historyIndexGet();
    for (const itemIdText of Object.keys(index)) {
      const itemId = Number(itemIdText);
      const bundle = loadPersistentHistory(itemId);
      if (!bundle) continue;
      histories.push(packHistoryBundle(bundle));
    }
    const calibration = [...state.calibrationMemory.values()].filter(e => e?.modelId === CALIBRATION_MODEL_ID);
    const payload = {
      type: 'umw_rw_database_export', schema: 1, dbSchema: RW_DB_VERSION,
      modelId: CALIBRATION_MODEL_ID, scriptVersion: VERSION, exportedAt: new Date().toISOString(),
      settingsHint: {
        historyDays: state.settings.historyDays,
        historyPerItemCap: state.settings.historyPerItemCap,
        historyStorageBudgetKb: state.settings.historyStorageBudgetKb,
      },
      histories, calibration,
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    triggerJsonDownload(`umw-rw-db-${stamp}.json`, payload);
    return { items: histories.length, calibration: calibration.length, bytes: JSON.stringify(payload).length * 2 };
  }

  async function importRwDatabaseFile(file) {
    if (!file) throw new Error('Choose a RW database JSON file first.');
    if (file.size > 20 * 1024 * 1024) throw new Error('RW database import is limited to 20 MB.');
    await ensureRwDatabaseReady();
    const text = await file.text();
    const data = JSON.parse(text);
    if (data?.type !== 'umw_rw_database_export' || Number(data.schema) !== 1 || !Array.isArray(data.histories)) throw new Error('That file is not a compatible RW database export.');
    let mergedItems = 0, importedSales = 0, rejected = 0;
    for (const packed of data.histories) {
      const itemId = Number(packed?.i);
      const incoming = unpackHistoryBundle(packed, itemId);
      if (!Number.isSafeInteger(itemId) || itemId <= 0 || !incoming) { rejected += 1; continue; }
      const existing = loadPersistentHistory(itemId);
      const sales = mergeHistorySales(existing?.sales || [], incoming.sales || []);
      const merged = {
        ...(existing || {}), ...incoming, requestedItemId: itemId, sales,
        lastSyncAt: Math.max(Number(existing?.lastSyncAt || 0), Number(incoming.lastSyncAt || 0)),
        lastDeepSyncAt: Math.max(Number(existing?.lastDeepSyncAt || 0), Number(incoming.lastDeepSyncAt || 0)),
        syncMode: 'import merge', databaseSales: sales.length, exactItemRows: sales.length,
      };
      savePersistentHistory(merged);
      if (state.dbMode === 'indexeddb' && state.db) await persistHistoryRecord(merged);
      importedSales += Math.max(0, sales.length - Number(existing?.sales?.length || 0));
      mergedItems += 1;
    }
    // Imported calibration is recomputed from validated sales.
    enforceHistoryStorageBudget(null);
    healthBump('imports');
    return { mergedItems, importedSales, rejected };
  }

  function sortResults(a, b) {
    if (a.error && !b.error) return 1;
    if (!a.error && b.error) return -1;
    if (a.error && b.error) return (a.itemId || 0) - (b.itemId || 0);
    return (b.dealScore - a.dealScore)
      || ((b.conservativeProfit ?? -Infinity) - (a.conservativeProfit ?? -Infinity))
      || (b.confidence - a.confidence);
  }

  // ---------------------------------------------------------------------------
  // Synthetic demo so the prototype UI can be inspected without live API calls.
  // Prices are intentionally fictional and labelled DEMO.
  // ---------------------------------------------------------------------------

  function runDemo() {
    const now = Math.floor(Date.now() / 1000);
    const target = {
      source: 'market', itemId: 399, itemName: 'DEMO ArmaLite M-15A4', uid: 'demo-target', rarity: 'Yellow',
      stats: { damage: 76.0, accuracy: 64.0, armor: null, quality: 72.0 },
      bonuses: [{ title: 'Sure Shot', value: 8.0 }],
      price: 238_000_000,
    };
    const samples = [
      [338, 8.1, 76.2, 64.1, 12],
      [305, 7.4, 75.6, 64.0, 31],
      [324, 7.9, 75.9, 63.6, 44],
      [350, 8.3, 76.4, 64.4, 58],
      [292, 7.1, 75.1, 63.3, 77],
      [315, 7.7, 75.8, 64.2, 109],
      [362, 8.5, 76.6, 64.5, 146],
      [270, 6.5, 74.8, 62.9, 195],
    ].map((x, idx) => ({
      source: 'auction', auctionId: `demo-${idx}`, itemId: 399, itemName: 'DEMO ArmaLite M-15A4', uid: `demo-${idx}`,
      rarity: 'Yellow',
      stats: { damage: x[2], accuracy: x[3], armor: null, quality: 60 + idx },
      bonuses: [{ title: 'Sure Shot', value: x[1] }],
      price: x[0] * 1_000_000,
      timestamp: now - x[4] * 86400,
      bids: 3 + idx,
    }));

    const result = applyOpportunityDecision(addMarketBuyMetrics(addDealMetrics(buildValuation(target, samples))));
    result.demo = true;
    state.lastResults = [result];
    state.status = 'DEMO mode: synthetic data only. No live Torn prices were used.';
    renderPanel();
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  const rootId = 'umw-rw-scout';
  const styleId = 'umw-rw-scout-style';

  function injectStyles() {
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      #${rootId}, #${rootId} * { box-sizing: border-box; }
      #${rootId} {
        --rws-bg:#10171c; --rws-surface:#182229; --rws-raised:#202d35; --rws-line:#2c3b43;
        --rws-ink:#edf4f4; --rws-muted:#9fb1b9; --rws-accent:#9fe4be; --rws-blue:#8cc8f2;
        --rws-warn:#edc480; --rws-bad:#ef9b95; --rws-good:#9fe4be;
        position:fixed; z-index:1000002; right:12px; bottom:12px;
        font:13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:var(--rws-ink); text-align:left;
      }
      #${rootId} button, #${rootId} input, #${rootId} select { font:inherit; }
      #${rootId} button { cursor:pointer; }
      #${rootId} :focus-visible { outline:2px solid var(--rws-accent); outline-offset:2px; }
      .rws-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; min-height:38px; border:1px solid var(--rws-line); background:var(--rws-surface); color:var(--rws-ink); border-radius:9px; padding:7px 11px; font-weight:650; }
      .rws-btn:hover { background:#26363f; border-color:#536b76; }
      .rws-btn:disabled { opacity:.5; cursor:wait; }
      .rws-btn.primary { background:var(--rws-accent); border-color:var(--rws-accent); color:#14281e; }
      .rws-btn.primary:hover { background:#c1f0d5; }
      .rws-btn.danger { color:#ffc0bb; border-color:#604343; background:#342526; }
      .rws-btn.ghost { background:transparent; }
      .rws-btn.icon { min-width:38px; padding:5px; font-size:20px; }
      .rws-fab { width:46px; height:46px; min-width:46px; min-height:46px; padding:0; border-radius:13px; box-shadow:0 8px 28px #0007; background:#172a22; border-color:#466052; color:var(--rws-accent); letter-spacing:.3px; }
      .rws-panel { width:min(980px,calc(100vw - 24px)); height:min(850px,calc(100dvh - 76px)); overflow:hidden; background:var(--rws-bg); border:1px solid #3a4b53; border-radius:18px; box-shadow:0 24px 90px #000b; display:flex; flex-direction:column; }
      .rws-head { display:flex; align-items:center; gap:12px; padding:15px 17px 12px; background:#131c21; border-bottom:1px solid var(--rws-line); }
      .rws-brand { display:flex; align-items:center; gap:10px; min-width:0; }
      .rws-brandmark { width:38px; height:38px; flex:0 0 38px; display:grid; place-items:center; border:1px solid #446554; background:#243c33; color:var(--rws-accent); border-radius:11px; font-size:11px; font-weight:800; }
      .rws-brandcopy { min-width:0; }
      .rws-title { display:flex; align-items:center; gap:7px; font-size:15px; font-weight:750; line-height:1.2; }
      .rws-subtitle { margin-top:3px; color:var(--rws-muted); font-size:10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .rws-test-pill { display:inline-flex; padding:2px 6px; border:1px solid #6d5b38; background:#302a20; color:var(--rws-warn); border-radius:999px; font-size:9px; letter-spacing:.6px; }
      .rws-head .spacer { flex:1; }
      .rws-status { display:flex; align-items:center; min-height:34px; padding:7px 17px; font-size:11px; background:#111a1f; border-bottom:1px solid var(--rws-line); color:var(--rws-muted); }
      .rws-status:before { content:''; width:6px; height:6px; border-radius:50%; background:var(--rws-accent); margin-right:8px; flex:0 0 auto; }
      .rws-status.busy:before { background:var(--rws-warn); box-shadow:0 0 0 3px #edc48022; }
      .rws-tabs { display:flex; gap:4px; padding:8px 12px 0; background:#131c21; border-bottom:1px solid var(--rws-line); overflow:auto; scrollbar-width:none; }
      .rws-tabs::-webkit-scrollbar { display:none; }
      .rws-tab { border:0; border-bottom:2px solid transparent; background:transparent; color:var(--rws-muted); min-height:38px; padding:7px 12px 9px; font-weight:650; white-space:nowrap; }
      .rws-tab.active { color:var(--rws-accent); border-bottom-color:var(--rws-accent); }
      .rws-tab .count { margin-left:5px; padding:1px 6px; background:#26343b; border-radius:999px; color:#b7c7ce; font-size:9px; }
      .rws-body { min-height:0; overflow:auto; overscroll-behavior:contain; padding:16px; flex:1; scrollbar-width:thin; scrollbar-color:#435b64 transparent; }
      .rws-section { border:1px solid var(--rws-line); border-radius:13px; margin-bottom:13px; background:var(--rws-surface); overflow:hidden; }
      .rws-section-head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:13px 15px; border-bottom:1px solid var(--rws-line); }
      .rws-section h3 { margin:0; font-size:14px; line-height:1.3; }
      .rws-section-sub { margin-top:3px; color:var(--rws-muted); font-size:11px; }
      .rws-section > h3 { margin:0; padding:12px 14px; font-size:14px; border-bottom:1px solid var(--rws-line); }
      .rws-section .inner { padding:14px; }
      .rws-callout { display:flex; align-items:flex-start; gap:10px; padding:11px 13px; margin-bottom:13px; border:1px solid #665537; background:#302a20; color:#dbcaa8; border-radius:11px; font-size:11px; }
      .rws-callout strong { color:var(--rws-warn); white-space:nowrap; }
      .rws-hero { display:grid; grid-template-columns:minmax(0,1.6fr) minmax(220px,.8fr); gap:12px; margin-bottom:13px; }
      .rws-hero-card { border:1px solid var(--rws-line); background:var(--rws-surface); border-radius:13px; padding:15px; }
      .rws-hero-title { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:7px; }
      .rws-hero-title strong { font-size:15px; }
      .rws-toggle-chip { display:inline-flex; align-items:center; gap:7px; padding:6px 9px; border:1px solid #446554; border-radius:999px; background:#1b3027; color:#c4ead2; font-size:11px; cursor:pointer; }
      .rws-toggle-chip.off { border-color:#4b5961; background:#202a30; color:#b4c0c5; }
      .rws-toggle-chip input { accent-color:#88d7ad; }
      .rws-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:11px; }
      .rws-metrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; margin-bottom:13px; }
      .rws-metric { min-width:0; padding:11px 12px; background:var(--rws-surface); border:1px solid var(--rws-line); border-radius:11px; }
      .rws-metric small { display:block; color:var(--rws-muted); font-size:9px; font-weight:700; letter-spacing:.6px; text-transform:uppercase; }
      .rws-metric strong { display:block; margin-top:4px; font-size:18px; line-height:1.2; overflow-wrap:anywhere; }
      .rws-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:9px; }
      .rws-row:last-child { margin-bottom:0; }
      .rws-input { min-height:40px; background:#111b21; color:var(--rws-ink); border:1px solid #3a4e58; border-radius:8px; padding:8px 10px; min-width:100px; }
      .rws-input.grow { flex:1; min-width:200px; }
      .rws-chip { display:inline-flex; align-items:center; gap:5px; background:#22323b; color:#bed1d8; border:1px solid #31444e; border-radius:999px; padding:4px 8px; font-size:11px; }
      .rws-chip button { border:0; background:transparent; color:#aebbc1; cursor:pointer; font-weight:800; padding:0 2px; }
      .rws-form-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; }
      .rws-field { display:flex; flex-direction:column; gap:5px; min-width:0; color:var(--rws-muted); font-size:10px; }
      .rws-field .rws-input { width:100% !important; min-width:0; }
      .rws-settings-group { margin-bottom:12px; border:1px solid var(--rws-line); border-radius:11px; overflow:hidden; background:#141f25; }
      .rws-settings-group summary { cursor:pointer; list-style:none; padding:11px 13px; font-weight:700; color:#dce8eb; }
      .rws-settings-group summary::-webkit-details-marker { display:none; }
      .rws-settings-group summary:after { content:'+'; float:right; color:var(--rws-muted); }
      .rws-settings-group[open] summary:after { content:'−'; }
      .rws-settings-group .group-body { padding:0 13px 13px; }
      .rws-muted { color:var(--rws-muted); font-size:11px; }
      .rws-note { font-size:11px; color:var(--rws-muted); line-height:1.5; }
      .rws-error { color:#ffaaa4; white-space:normal; }
      .rws-good { color:#9fe4be; }
      .rws-warn { color:#edc480; }
      .rws-bad { color:#ef9b95; }
      .rws-score { font-weight:800; font-size:13px; }
      .rws-table-wrap { overflow:auto; border-top:1px solid var(--rws-line); }
      .rws-table { width:100%; border-collapse:collapse; font-size:11px; }
      .rws-table th, .rws-table td { border-bottom:1px solid #26363e; padding:8px 7px; vertical-align:top; text-align:left; white-space:nowrap; }
      .rws-table th { position:sticky; top:0; background:#1b272e; z-index:1; color:#9fb1b9; font-size:9px; text-transform:uppercase; letter-spacing:.4px; }
      .rws-table tr.clickable { cursor:pointer; }
      .rws-table tr.clickable:hover { background:#202e35; }
      .rws-details { padding:12px; background:#111a1f; border:1px solid var(--rws-line); border-radius:10px; margin:6px 0; white-space:normal; }
      .rws-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:7px; margin-bottom:10px; }
      .rws-stat { min-width:0; background:#1b272e; border:1px solid #2e4049; border-radius:8px; padding:8px; }
      .rws-stat small { color:var(--rws-muted); display:block; font-size:9px; }
      .rws-stat strong { display:block; margin-top:3px; overflow-wrap:anywhere; }
      .rws-detail-block { border-top:1px solid var(--rws-line); padding-top:10px; margin-top:10px; }
      .rws-detail-block > summary { cursor:pointer; color:#dce8eb; font-weight:700; margin-bottom:8px; }
      .rws-result-cards { display:none; gap:9px; padding:10px; }
      .rws-result-card { border:1px solid var(--rws-line); border-radius:11px; background:#162128; padding:11px; cursor:pointer; }
      .rws-result-card.strong-buy { border-color:#4c765b; box-shadow:inset 3px 0 #6fd293; }
      .rws-result-card.good-buy { border-color:#426354; box-shadow:inset 3px 0 #8ecaa1; }
      .rws-result-card.watch { box-shadow:inset 3px 0 #d4ad62; }
      .rws-result-card.marginal { box-shadow:inset 3px 0 #c98d5c; }
      .rws-result-card.pass { opacity:.88; }
      .rws-card-head { display:flex; justify-content:space-between; gap:10px; align-items:flex-start; }
      .rws-card-title { min-width:0; }
      .rws-card-title strong { display:block; font-size:13px; overflow-wrap:anywhere; }
      .rws-card-price { text-align:right; white-space:nowrap; }
      .rws-card-price strong { display:block; font-size:16px; }
      .rws-card-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; margin-top:9px; }
      .rws-card-kv { padding:7px; border-radius:7px; background:#1c2a31; }
      .rws-card-kv small { display:block; color:var(--rws-muted); font-size:9px; }
      .rws-card-kv strong { display:block; margin-top:2px; overflow-wrap:anywhere; }
      .rws-card-foot { display:flex; gap:6px; flex-wrap:wrap; margin-top:9px; }
      .rws-opportunity { display:inline-flex; align-items:center; border-radius:999px; padding:3px 7px; font-weight:800; font-size:9px; letter-spacing:.35px; }
      .rws-opportunity.strong-buy { color:#c8f5d2; background:#23432e; }
      .rws-opportunity.good-buy { color:#c1ead0; background:#263c31; }
      .rws-opportunity.watch { color:#f1d493; background:#3a3120; }
      .rws-opportunity.marginal { color:#efbd90; background:#3a2b20; }
      .rws-opportunity.pass { color:#d2a7a7; background:#312426; }
      .rws-ah-inline { display:flex; flex-wrap:wrap; align-items:center; gap:4px 7px; margin-top:4px; padding:4px 7px; border:1px solid #4d6069; border-radius:7px; font:700 9px/1.25 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#d9e2e5; background:rgba(18,28,33,.94); width:max-content; max-width:100%; cursor:pointer; }
      .rws-ah-inline .state { font-weight:900; }
      .rws-ah-inline .sub { color:#aebfc6; font-weight:600; }
      .rws-ah-inline.strong-buy { border-color:#55b96a; color:#c5f3cb; background:rgba(24,73,34,.92); }
      .rws-ah-inline.good-buy { border-color:#6a9f73; color:#b7e7bf; }
      .rws-ah-inline.watch { border-color:#b79245; color:#f0cf7a; }
      .rws-ah-inline.marginal { border-color:#a87345; color:#eeb77f; }
      .rws-ah-inline.pass { border-color:#6c5555; color:#c6a4a4; opacity:.86; }
      #rws-ah-summary { position:fixed; z-index:1000001; top:max(8px,env(safe-area-inset-top)); right:8px; max-width:min(94vw,660px); border:1px solid #52636c; border-radius:10px; background:rgba(16,24,29,.96); color:#dce5e8; padding:8px 11px; font:700 10px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; box-shadow:0 5px 18px #0008; cursor:pointer; }
      #rws-ah-summary[data-tone=strong]{border-color:#55b96a;color:#c5f3cb} #rws-ah-summary[data-tone=good]{border-color:#6a9f73;color:#b7e7bf} #rws-ah-summary[data-tone=watch]{border-color:#b79245;color:#f0cf7a}
      .rws-health-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
      .rws-health-card { padding:12px; background:#162128; border:1px solid var(--rws-line); border-radius:10px; }
      .rws-health-card small { display:block; color:var(--rws-muted); font-size:9px; text-transform:uppercase; letter-spacing:.5px; }
      .rws-health-card strong { display:block; margin-top:4px; font-size:16px; overflow-wrap:anywhere; }
      .rws-empty { text-align:center; padding:28px 18px; color:var(--rws-muted); }
      .rws-empty strong { display:block; color:#dce8eb; margin-bottom:5px; }
      #umw-rwtest-tab { color:var(--umw-accent,#9fe4be)!important; }
      @media (max-width:760px) {
        #${rootId} { right:4px; bottom:4px; }
        .rws-panel { width:calc(100vw - 8px); height:calc(100dvh - 72px); border-radius:15px; }
        .rws-head { padding:12px; }
        .rws-subtitle { max-width:48vw; }
        .rws-body { padding:11px; }
        .rws-hero { grid-template-columns:1fr; }
        .rws-metrics { grid-template-columns:repeat(2,minmax(0,1fr)); }
        .rws-form-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
        .rws-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }
        .rws-table-wrap.desktop-results { display:none; }
        .rws-result-cards { display:grid; }
        .rws-actions .rws-btn { flex:1 1 145px; }
        .rws-input.grow { min-width:100%; }
        #rws-ah-summary { top:max(5px,env(safe-area-inset-top)); right:5px; left:5px; max-width:none; text-align:center; }
      }
      @media (max-width:430px) {
        .rws-form-grid { grid-template-columns:1fr; }
        .rws-health-grid { grid-template-columns:1fr 1fr; }
        .rws-tabs { padding-left:6px; padding-right:6px; }
        .rws-tab { padding-left:9px; padding-right:9px; }
      }
      @media (prefers-reduced-motion:reduce) { #${rootId} * { transition:none!important; } }
    `;
    style.textContent += '\n      #umw-rw-scout {position:static; width:100%; min-width:0; max-width:100%;}\n      #umw-rw-scout .rws-panel {width:100%;height:auto;max-height:none;border:0;border-radius:0;box-shadow:none;overflow:visible;}\n      #umw-rw-scout .rws-body {overflow:visible;padding:10px 0;}\n      #umw-rw-scout .rws-head {padding:8px 0;}\n      #umw-rw-scout .rws-tabs {display:grid;grid-template-columns:repeat(4,minmax(0,1fr));padding:8px 0;gap:4px;}\n      #umw-rw-scout .rws-tab {white-space:normal;min-width:0;padding:8px 4px;min-height:42px;}\n      #umw-rw-scout .rws-form-grid {grid-template-columns:repeat(auto-fit,minmax(min(190px,100%),1fr));}\n      #umw-rw-scout .rws-hero-grid {grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));}\n      #umw-rw-scout .rws-metrics,#umw-rw-scout .rws-health-grid {grid-template-columns:repeat(auto-fit,minmax(min(135px,100%),1fr));}\n      #umw-rw-scout .rws-input {max-width:100%;min-width:0;}\n      #umw-rw-scout .rws-input.grow {min-width:120px;}\n      #umw-rw-scout .desktop-results {display:none;}\n      #umw-rw-scout .rws-result-cards {display:grid;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));}\n      #umw-rw-scout .rws-result-card {min-width:0;overflow-wrap:anywhere;}\n      #umw-rw-scout .rws-table-wrap {max-width:100%;overflow:auto;}\n      #umw-debug-panel[data-layout="compact"] #umw-rw-scout .rws-card-head {flex-wrap:wrap;}\n      #umw-debug-panel[data-layout="compact"] #umw-rw-scout .rws-card-grid {grid-template-columns:repeat(2,minmax(0,1fr));}\n      #umw-debug-panel[data-layout="compact"] #umw-rw-scout .rws-form-grid {grid-template-columns:1fr;}\n      #umw-debug-panel .umw-tabs {grid-template-columns:repeat(4,minmax(0,1fr));}\n';
    document.head.appendChild(style);
  }

  let mountedRoot = null;
  function mount() {
    if (mountedRoot) return mountedRoot;
    injectStyles();
    mountedRoot = document.createElement('div');
    mountedRoot.id = rootId;
    mountedRoot.dataset.open = '1';
    mountedRoot.addEventListener('click', event => {
      try { Promise.resolve(onClick(event)).catch(e => setStatus(cleanApiErrorMessage(e))); }
      catch(e) { setStatus(cleanApiErrorMessage(e)); }
    });
    mountedRoot.addEventListener('change', onChange);
    return mountedRoot;
  }

  function setStatus(text) {
    state.status = text;
    const el = document.querySelector(`#${rootId} .rws-status`);
    if (el) el.textContent = text;
  }

  function resultMode() {
    if (!state.lastResults.length) return 'none';
    return state.lastResults.some(r => !r.error && r.target?.source === 'auction-live') ? 'auction' : 'market';
  }

  function renderTopMetrics() {
    const valid = state.lastResults.filter(r => !r.error);
    const mode = resultMode();
    const strong = valid.filter(r => r.opportunityClass === 'STRONG BUY').length;
    const viable = valid.filter(r => ['STRONG BUY','GOOD BUY','WATCH'].includes(r.opportunityClass)).length;
    const best = valid.filter(r => Number.isFinite(r.profitNow)).sort((a,b)=>b.profitNow-a.profitNow)[0];
    const avgConfidence = valid.length ? Math.round(valid.reduce((s,r)=>s+Number(r.confidence||0),0)/valid.length) : 0;
    return `<div class="rws-metrics">
      <div class="rws-metric"><small>${mode === 'auction' ? 'Visible RW' : 'Ranked listings'}</small><strong>${valid.length}</strong></div>
      <div class="rws-metric"><small>Viable</small><strong>${viable}${strong ? ` · ${strong} strong` : ''}</strong></div>
      <div class="rws-metric"><small>Best estimated profit</small><strong>${best ? fmtMoney(best.profitNow) : '—'}</strong></div>
      <div class="rws-metric"><small>Avg confidence</small><strong>${valid.length ? `${avgConfidence}/100` : '—'}</strong></div>
    </div>`;
  }

  function renderSniperView() {
    const mode = resultMode();
    return `
      <div class="rws-hero">
        <div class="rws-hero-card">
          <div class="rws-hero-title"><strong>Auction House sniper</strong><label class="rws-toggle-chip ${state.settings.autoAuctionSniper ? '' : 'off'}"><input type="checkbox" data-setting="autoAuctionSniper" ${state.settings.autoAuctionSniper ? 'checked' : ''}> Auto ${state.settings.autoAuctionSniper ? 'ON' : 'OFF'}</label></div>
          <div class="rws-note">Analyzes the Auction House page you are browsing, values visible RW gear from completed sales, and updates bid room locally as bids move.</div>
          <div class="rws-actions"><button class="rws-btn primary" data-action="scan-auction" ${state.busy ? 'disabled' : ''}>Analyze visible page</button><button class="rws-btn" data-action="force-scan-auction" ${state.busy ? 'disabled' : ''}>Refresh history + analyze</button></div>
        </div>
        <div class="rws-hero-card">
          <div class="rws-hero-title"><strong>Current rules</strong></div>
          <div class="rws-note">Good buy: ${state.settings.auctionTargetRoiPct}% ROI · ${fmtMoney(state.settings.auctionMinProfit)} profit<br>Absolute: ${state.settings.auctionAbsoluteRoiPct}% ROI · ${fmtMoney(state.settings.auctionAbsoluteMinProfit)} profit<br>Highlight: C${state.settings.highlightMinConfidence}+ · L${state.settings.highlightMinLiquidity}+</div>
          <div class="rws-actions"><button class="rws-btn ghost" data-action="view-settings">Edit rules</button></div>
        </div>
      </div>
      ${mode === 'auction' ? renderTopMetrics() + renderAuctionResults() : `<div class="rws-section"><div class="rws-empty"><strong>No Auction House results loaded</strong>Open Torn's Auction House and let Auto AH run, or tap Analyze visible page.</div></div>`}
    `;
  }

  function renderMarketView() {
    const mode = resultMode();
    return `
      <div class="rws-section">
        <div class="rws-section-head"><div><h3>RW Item Market scanner</h3><div class="rws-section-sub">Use item IDs from your normal watchlist or add one-off RW items.</div></div></div>
        <div class="inner">
          <div class="rws-row"><input class="rws-input grow" data-role="add-ids" placeholder="Item IDs, e.g. 399, 219, 612"><button class="rws-btn" data-action="add-ids">Add</button><button class="rws-btn" data-action="sync-umw">Sync from MW</button><button class="rws-btn" data-action="add-current">Current item</button></div>
          <div class="rws-row">${state.watchlist.length ? state.watchlist.map(id => `<span class="rws-chip">#${id}<button data-action="remove-id" data-id="${id}" aria-label="Remove item ${id}">×</button></span>`).join('') : '<span class="rws-muted">No RW item IDs saved yet.</span>'}</div>
          <div class="rws-actions"><button class="rws-btn primary" data-action="scan" ${state.busy ? 'disabled' : ''}>Scan watchlist</button><button class="rws-btn" data-action="force-scan" ${state.busy ? 'disabled' : ''}>Refresh history + scan</button><button class="rws-btn ghost" data-action="demo">Synthetic demo</button></div>
        </div>
      </div>
      ${mode === 'market' ? renderTopMetrics() + renderMarketResults() : `<div class="rws-section"><div class="rws-empty"><strong>No Item Market results loaded</strong>Run a watchlist scan to rank current RW listings.</div></div>`}
    `;
  }

  function field(label, name, value, attrs='') {
    return `<label class="rws-field"><span>${label}</span><input class="rws-input" data-setting="${name}" ${attrs} value="${escapeHtml(value)}"></label>`;
  }

  function renderSettingsView() {
    const hasKey = !!getApiKey();
    return `
      <div class="rws-section">
        <div class="rws-section-head"><div><h3>Settings</h3><div class="rws-section-sub">Trading rules, scan behavior and model controls.</div></div><button class="rws-btn primary" data-action="save-settings">Save & reclassify</button></div>
        <div class="inner">
          <div class="rws-note">Uses your Market Watcher account and shared request pacing. <button class="rws-btn" data-action="main-settings">Account settings</button></div>
          <details class="rws-settings-group" open><summary>Buy ceilings</summary><div class="group-body"><div class="rws-form-grid">
            ${field('Good ROI %','auctionTargetRoiPct',state.settings.auctionTargetRoiPct,'type="number" min="0" max="200" step="0.5"')}
            ${field('Good min profit','auctionMinProfit',state.settings.auctionMinProfit,'type="number" min="0" step="1000000"')}
            ${field('Good safety %','auctionSafetyPct',state.settings.auctionSafetyPct,'type="number" min="0" max="50" step="0.5"')}
            ${field('Absolute ROI %','auctionAbsoluteRoiPct',state.settings.auctionAbsoluteRoiPct,'type="number" min="0" max="200" step="0.5"')}
            ${field('Absolute min profit','auctionAbsoluteMinProfit',state.settings.auctionAbsoluteMinProfit,'type="number" min="0" step="1000000"')}
            ${field('Absolute safety %','auctionAbsoluteSafetyPct',state.settings.auctionAbsoluteSafetyPct,'type="number" min="0" max="50" step="0.5"')}
            ${field('Minimum confidence','auctionMinConfidence',state.settings.auctionMinConfidence,'type="number" min="0" max="100" step="1"')}
            ${field('Resale fee %','marketFeePct',state.settings.marketFeePct,'type="number" min="0" max="25" step="0.1"')}
          </div></div></details>
          <details class="rws-settings-group"><summary>Opportunity filters</summary><div class="group-body"><div class="rws-form-grid">
            ${field('Highlight profit ≥','highlightMinProfit',state.settings.highlightMinProfit,'type="number" min="0" step="1000000"')}
            ${field('Highlight ROI ≥ %','highlightMinRoiPct',state.settings.highlightMinRoiPct,'type="number" min="0" max="500" step="0.5"')}
            ${field('Confidence ≥','highlightMinConfidence',state.settings.highlightMinConfidence,'type="number" min="0" max="100" step="1"')}
            ${field('Liquidity ≥','highlightMinLiquidity',state.settings.highlightMinLiquidity,'type="number" min="0" max="100" step="1"')}
            ${field('Max capital $','highlightMaxCapital',state.settings.highlightMaxCapital,'type="number" min="0" step="10000000"')}
            ${field('Ending soon minutes','endingSoonMinutes',state.settings.endingSoonMinutes,'type="number" min="1" max="120" step="1"')}
          </div><div class="rws-row"><label class="rws-chip"><input type="checkbox" data-setting="highlightDirectOnly" ${state.settings.highlightDirectOnly ? 'checked' : ''}> Require DIRECT comp</label><label class="rws-chip"><input type="checkbox" data-setting="marketSanityEnabled" ${state.settings.marketSanityEnabled ? 'checked' : ''}> Current-market sanity check</label></div></div></details>
          <details class="rws-settings-group"><summary>History & API pacing</summary><div class="group-body"><div class="rws-form-grid">
            ${field('History days','historyDays',state.settings.historyDays,'type="number" min="30" max="1500" step="1"')}
            ${field('History pages','maxAuctionPages',state.settings.maxAuctionPages,'type="number" min="1" max="10" step="1"')}
            ${field('Market pages','maxMarketPages',state.settings.maxMarketPages,'type="number" min="1" max="5" step="1"')}
            ${field('Min comp score','minCompScore',state.settings.minCompScore,'type="number" min="0" max="100" step="1"')}
            ${field('History sync min','historyCacheMinutes',state.settings.historyCacheMinutes,'type="number" min="1" max="10080" step="1"')}
            ${field('Sales per item cap','historyPerItemCap',state.settings.historyPerItemCap,'type="number" min="100" max="2000" step="50"')}
            ${field('DB budget KB','historyStorageBudgetKb',state.settings.historyStorageBudgetKb,'type="number" min="256" max="4096" step="128"')}
            ${field('Current-market cache min','marketSanityCacheMinutes',state.settings.marketSanityCacheMinutes,'type="number" min="1" max="1440" step="1"')}
          </div></div></details>
          <details class="rws-settings-group"><summary>Backtest calibration</summary><div class="group-body"><div class="rws-row"><label class="rws-chip"><input type="checkbox" data-setting="calibrationEnabled" ${state.settings.calibrationEnabled ? 'checked' : ''}> Calibration enabled</label></div><div class="rws-form-grid">
            ${field('Minimum samples','calibrationMinSamples',state.settings.calibrationMinSamples,'type="number" min="3" max="50" step="1"')}
            ${field('Maximum adjust %','calibrationMaxAdjustPct',state.settings.calibrationMaxAdjustPct,'type="number" min="0" max="20" step="0.5"')}
            ${field('Backtests per item','calibrationBacktestPerItem',state.settings.calibrationBacktestPerItem,'type="number" min="4" max="30" step="1"')}
            ${field('Refresh hours','calibrationRefreshHours',state.settings.calibrationRefreshHours,'type="number" min="1" max="720" step="1"')}
          </div><div class="rws-note">Calibration is built only from held-out completed auctions, is sample-gated, shrunk toward zero and capped.</div></div></details>
          <div class="rws-actions"><button class="rws-btn primary" data-action="save-settings">Save & reclassify</button></div>
        </div>
      </div>`;
  }

  function renderDataView() {
    const h = databaseHealthStats(); const c = h.calibration || {}; const m = h.migration || {};
    return `
      <div class="rws-health-grid">
        <div class="rws-health-card"><small>Storage</small><strong>${escapeHtml(h.dbMode)}</strong><span class="rws-muted">schema ${h.schemaVersion}</span></div>
        <div class="rws-health-card"><small>Completed sales</small><strong>${h.sales.toLocaleString()}</strong><span class="rws-muted">${h.items} item types</span></div>
        <div class="rws-health-card"><small>RW budget</small><strong>${formatStorageBytes(h.bytes)}</strong><span class="rws-muted">of ${formatStorageBytes(h.budget)}</span></div>
        <div class="rws-health-card"><small>Comp groups</small><strong>${h.groups.toLocaleString()}</strong><span class="rws-muted">rarity / bonus groups</span></div>
        <div class="rws-health-card"><small>UID cache</small><strong>${h.uidEntries}</strong><span class="rws-muted">${formatStorageBytes(h.uidBytes)}</span></div>
        <div class="rws-health-card"><small>Backtests</small><strong>${c.samples || 0}</strong><span class="rws-muted">MAE ${((c.maePct||0)*100).toFixed(1)}%</span></div>
      </div>
      <div class="rws-section" style="margin-top:13px"><div class="rws-section-head"><div><h3>Database health</h3><div class="rws-section-sub">Persistence, migration, rejection and calibration diagnostics.</div></div></div><div class="inner">
        <div class="rws-note">Sales span ${h.oldestSale ? formatUnixDate(h.oldestSale) : '—'} → ${h.newestSale ? formatUnixDate(h.newestSale) : '—'} · latest sync ${h.newestSync ? formatAgoMs(h.newestSync) : 'never'}.</div>
        <div class="rws-note" style="margin-top:8px">Wrong-item rows rejected: ${h.mismatched} · invalid rows: ${h.invalid} · history evictions: ${h.evictions}.${h.dbError ? ` <span class="rws-error">DB: ${escapeHtml(h.dbError)}</span>` : ''}</div>
        <div class="rws-note" style="margin-top:8px"><strong>Migration:</strong> ${m.legacyFound||0} found · ${m.migrated||0} migrated · ${m.skipped||0} skipped · ${m.failed||0} failed${m.completedAt ? ` · ${formatAgoMs(m.completedAt)}` : ''}.</div>
        <div class="rws-note" style="margin-top:8px"><strong>Calibration:</strong> ${c.samples||0} predictions · ${c.broadSegments||0} segments · MAE ${((c.maePct||0)*100).toFixed(1)}% · bias ${((c.biasPct||0)*100).toFixed(1)}% · avg adjustment ${((c.averageAppliedPct||0)*100).toFixed(1)}% · ${c.running||0} running.</div>
        <div class="rws-actions"><button class="rws-btn" data-action="prune-db">Prune / enforce limits</button><button class="rws-btn" data-action="clear-uid-cache">Clear UID cache</button><button class="rws-btn" data-action="recalibrate-db">Re-run backtests</button></div>
      </div></div>
      <div class="rws-section"><div class="rws-section-head"><div><h3>Backup & maintenance</h3><div class="rws-section-sub">Exports never include your Torn API key.</div></div></div><div class="inner"><div class="rws-actions"><button class="rws-btn primary" data-action="export-db">Export RW DB</button><label class="rws-btn">Import / merge RW DB<input data-role="import-db-file" type="file" accept=".json,application/json" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none"></label><button class="rws-btn danger" data-action="clear-cache">Clear RW sales database</button></div></div></div>`;
  }

  function renderPanel() {
    injectStyles();
    const root = mount();
    if (root.contains(document.activeElement) && document.activeElement.matches('input,select,textarea')) return;
    const openDetails = [...root.querySelectorAll('details[open]')].map(e=>e.querySelector('summary')?.textContent);
    const hadContent = !!root.firstElementChild && root.dataset.view===state.uiView;
    root.dataset.view=state.uiView;
    if (!['sniper','market','settings','data'].includes(state.uiView)) state.uiView = location.href.includes('amarket.php') ? 'sniper' : 'market';
    const validCount = state.lastResults.filter(r=>!r.error).length;
    const dbStats = historyStorageStats();
    const viewHtml = state.uiView === 'sniper' ? renderSniperView() : state.uiView === 'market' ? renderMarketView() : state.uiView === 'settings' ? renderSettingsView() : renderDataView();
    root.innerHTML = `
      <div class="rws-panel">
        <div class="rws-head">
          <div class="rws-brand"><span class="rws-brandmark">RW</span><div class="rws-brandcopy"><div class="rws-title">Ranked War Scout </div><div class="rws-subtitle">Market Watcher · v${VERSION} · ${state.dbMode === 'indexeddb' ? 'IndexedDB' : state.dbMode}</div></div></div>
          
        </div>
        <div class="rws-status ${state.busy ? 'busy' : ''}">${escapeHtml(state.status)}</div>
        <nav class="rws-tabs" aria-label="RW Scout views">
          <button class="rws-tab ${state.uiView==='sniper'?'active':''}" data-action="view-sniper">AH Sniper${resultMode()==='auction'&&validCount?`<span class="count">${validCount}</span>`:''}</button>
          <button class="rws-tab ${state.uiView==='market'?'active':''}" data-action="view-market">Item Market${resultMode()==='market'&&validCount?`<span class="count">${validCount}</span>`:''}</button>
          <button class="rws-tab ${state.uiView==='settings'?'active':''}" data-action="view-settings">Settings</button>
          <button class="rws-tab ${state.uiView==='data'?'active':''}" data-action="view-data">Data<span class="count">${dbStats.sales||0}</span></button>
        </nav>
        <div class="rws-body">
          <div class="rws-callout"><strong>RW Scout</strong><span>Analyze equipment using completed sales. Choose a view below to scan, adjust buying rules, or manage saved data.</span></div>
          ${viewHtml}
        </div>
      </div>`;
    if (hadContent) root.querySelectorAll('details').forEach(e=>e.open=openDetails.includes(e.querySelector('summary')?.textContent));
    root.querySelector('.rws-status')?.setAttribute('role','status');
    root.querySelectorAll('.rws-tab').forEach(e=>e.setAttribute('aria-current',e.classList.contains('active')?'page':'false'));
  }

  function renderResults() {
    if (!state.lastResults.length) return `<div class="rws-section"><div class="rws-empty"><strong>No results yet</strong>Scan a watchlist item or analyze an Auction House page.</div></div>`;
    return resultMode() === 'auction' ? renderAuctionResults() : renderMarketResults();
  }

  function renderMarketResults() {
    const cards = [];
    const rows = state.lastResults.map((r, idx) => {
      if (r.error) return `<tr><td>${r.itemId}</td><td colspan="11" class="rws-error">${escapeHtml(r.message)}</td></tr>`;
      const t = r.target; const key = `${t.itemId}:${t.uid ?? idx}:${t.price}`; const expanded = state.expandedKey === key;
      const bonusText = t.bonuses.map(b => { const p=(r.bonusProfile||[]).find(x=>normalizeBonusKey(x.title)===normalizeBonusKey(b.title)); return `${escapeHtml(b.title)} ${Number.isFinite(b.value) ? escapeHtml(b.value) : ''}${Number.isFinite(p?.percentile) ? ` (P${Math.round(p.percentile*100)} ${escapeHtml(p.classCode)})` : ''}`; }).join(' + ');
      const stats = Number.isFinite(t.stats.armor) ? `AR ${fmtNum(t.stats.armor)}` : `DMG ${fmtNum(t.stats.damage)} / ACC ${fmtNum(t.stats.accuracy)}`;
      const confClass = r.confidence >= 80 ? 'rws-good' : r.confidence >= 60 ? 'rws-warn' : 'rws-bad'; const compCount = r.pricingComps?.length ?? 0;
      cards.push(`<article class="rws-result-card ${opportunityCssClass(r.opportunityClass)}" data-action="expand-result" data-key="${escapeHtml(key)}"><div class="rws-card-head"><div class="rws-card-title"><span class="rws-opportunity ${opportunityCssClass(r.opportunityClass)}">${escapeHtml(r.opportunityClass||'PASS')}</span><strong>${escapeHtml(t.itemName)}</strong><span class="rws-muted">${escapeHtml(t.rarity)} · ${bonusText||'No bonus'}</span></div><div class="rws-card-price"><small class="rws-muted">ASK</small><strong>${fmtMoney(t.price)}</strong><span class="${r.profitNow>0?'rws-good':'rws-bad'}">${fmtMoney(r.profitNow)} · ${fmtPct(r.roiNow)}</span></div></div><div class="rws-card-grid"><div class="rws-card-kv"><small>Good buy max</small><strong>${fmtMoney(r.recommendedMaxBuy)}</strong></div><div class="rws-card-kv"><small>Absolute max</small><strong>${fmtMoney(r.absoluteMaxBuy)}</strong></div><div class="rws-card-kv"><small>Sold range</small><strong>${Number.isFinite(r.fair)?`${fmtMoney(r.low)}–${fmtMoney(r.high)}`:'Insufficient comps'}</strong></div><div class="rws-card-kv"><small>Confidence / liquidity</small><strong>C${r.confidence} · L${r.liquidity?.score??0}</strong></div></div><div class="rws-card-foot"><span class="rws-chip">${escapeHtml(r.compSummary||'0 comps')}</span><span class="rws-chip">Deal ${r.dealScore}/100</span><span class="rws-chip">${escapeHtml(stats)}</span></div>${expanded ? renderDetails(r) : ''}</article>`);
      return `<tr class="clickable" data-action="expand-result" data-key="${escapeHtml(key)}"><td><span class="rws-opportunity ${opportunityCssClass(r.opportunityClass)}">${escapeHtml(r.opportunityClass||'PASS')}</span><br><strong>${escapeHtml(t.itemName)}</strong><br><span class="rws-muted">${escapeHtml(t.rarity)} · ${escapeHtml(r.compSummary||'')}</span></td><td>${bonusText||'—'}<br><span class="rws-muted">${stats}</span></td><td>${fmtMoney(t.price)}</td><td><strong>${fmtMoney(r.recommendedMaxBuy)}</strong></td><td>${fmtMoney(r.absoluteMaxBuy)}</td><td>${fmtMoney(r.buyHeadroom)}<br><span class="rws-muted">abs ${fmtMoney(r.absoluteBuyHeadroom)}</span></td><td>${Number.isFinite(r.fair)?`${fmtMoney(r.low)} – ${fmtMoney(r.high)}<br><span class="rws-muted">mid ${fmtMoney(r.fair)}</span>`:'<span class="rws-warn">Insufficient comps</span>'}</td><td class="${r.profitNow>0?'rws-good':'rws-bad'}"><strong>${fmtMoney(r.profitNow)}</strong><br><span class="rws-muted">${fmtPct(r.roiNow)}</span></td><td class="${confClass}"><span class="rws-score">${r.confidence}</span></td><td><span class="rws-score">${r.liquidity?.score??0}</span></td><td><span class="rws-score">${r.dealScore}</span></td><td>${compCount}<br><span class="rws-muted">${r.directCount??0} direct</span></td></tr>${expanded?`<tr><td colspan="12">${renderDetails(r)}</td></tr>`:''}`;
    }).join('');
    return `<div class="rws-section"><div class="rws-section-head"><div><h3>Ranked Item Market listings</h3><div class="rws-section-sub">Sorted by deal quality. Tap a row/card for comp detail.</div></div></div><div class="rws-table-wrap desktop-results"><table class="rws-table"><thead><tr><th>Decision / item</th><th>Roll</th><th>Ask</th><th>Good max</th><th>Absolute</th><th>Room</th><th>Sold range</th><th>Profit / ROI</th><th>Conf</th><th>Liq</th><th>Deal</th><th>Comps</th></tr></thead><tbody>${rows}</tbody></table></div><div class="rws-result-cards">${cards.join('')}</div></div>`;
  }

  function renderAuctionResults() {
    const cards = [];
    const rows = state.lastResults.map((r, idx) => {
      if (r.error) return `<tr><td colspan="13" class="rws-error">${escapeHtml(r.message)}</td></tr>`;
      const t = r.target; const key = `AH:${t.rowKey || `${t.itemId}:${t.uid}:${idx}`}`; const expanded = state.expandedKey === key;
      const bonuses = t.bonuses.map(b => { const p=(r.bonusProfile||[]).find(x=>normalizeBonusKey(x.title)===normalizeBonusKey(b.title)); return `${escapeHtml(b.title)} ${Number.isFinite(b.value) ? escapeHtml(b.value) : ''}${Number.isFinite(p?.percentile) ? ` (P${Math.round(p.percentile*100)} ${escapeHtml(p.classCode)})` : ''}`; }).join(' + ');
      const stats = Number.isFinite(t.stats.armor) ? `AR ${fmtNum(t.stats.armor)}` : `DMG ${fmtNum(t.stats.damage)} / ACC ${fmtNum(t.stats.accuracy)}`;
      const confClass = r.confidence >= 80 ? 'rws-good' : r.confidence >= 60 ? 'rws-warn' : 'rws-bad'; const liq = r.liquidity || {score:0,label:'—'};
      const remaining = Number.isFinite(t.remainingSeconds) ? formatDuration(t.remainingSeconds) : '—'; const trend = r.trend?.label && r.trend.label !== 'UNKNOWN' ? r.trend.label : '—'; const opportunityClass = opportunityCssClass(r.opportunityClass);
      const sanity = r.marketSanity?.available ? `${fmtMoney(r.marketSanity.median)}<br><span class="rws-muted">${escapeHtml(r.marketSanity.mode)}${Number.isFinite(r.marketSanity.vsHistoryPct)?` · ${fmtPct(r.marketSanity.vsHistoryPct)}`:''}</span>` : '<span class="rws-muted">—</span>';
      const reasons = r.rejectReasons?.length ? r.rejectReasons.join(' · ') : 'passes configured filters';
      cards.push(`<article class="rws-result-card ${opportunityClass}" data-action="expand-result" data-key="${escapeHtml(key)}"><div class="rws-card-head"><div class="rws-card-title"><span class="rws-opportunity ${opportunityClass}">${escapeHtml(r.opportunityClass||'PASS')}</span><strong>${escapeHtml(t.itemName)}</strong><span class="rws-muted">${escapeHtml(t.rarity)} · ${bonuses||'No bonus'}</span></div><div class="rws-card-price"><small class="rws-muted">CURRENT · ${remaining}</small><strong>${fmtMoney(t.currentBid)}</strong><span class="${r.profitNow>0?'rws-good':'rws-bad'}">${fmtMoney(r.profitNow)} · ${fmtPct(r.roiNow)}</span></div></div><div class="rws-card-grid"><div class="rws-card-kv"><small>Next bid</small><strong>${fmtMoney(r.minLegalBid)}</strong></div><div class="rws-card-kv"><small>Good / absolute max</small><strong>${fmtMoney(r.recommendedMaxBid)} / ${fmtMoney(r.absoluteMaxBid)}</strong></div><div class="rws-card-kv"><small>Sold range</small><strong>${Number.isFinite(r.fair)?`${fmtMoney(r.low)}–${fmtMoney(r.high)}`:'Insufficient comps'}</strong></div><div class="rws-card-kv"><small>Confidence / liquidity</small><strong>C${r.confidence} · L${liq.score}</strong></div></div><div class="rws-card-foot"><span class="rws-chip">${escapeHtml(r.compSummary||'0 comps')}</span><span class="rws-chip">${escapeHtml(trend)}</span><span class="rws-chip">${escapeHtml(stats)}</span></div>${r.rejectReasons?.length?`<div class="rws-note" style="margin-top:8px">${escapeHtml(reasons)}</div>`:''}${expanded?renderDetails(r):''}</article>`);
      return `<tr class="clickable" data-action="expand-result" data-key="${escapeHtml(key)}"><td><span class="rws-opportunity ${opportunityClass}">${escapeHtml(r.opportunityClass||'PASS')}</span><br><span class="rws-muted">${escapeHtml(reasons)}</span></td><td><strong>${escapeHtml(t.itemName)}</strong><br><span class="rws-muted">${escapeHtml(t.rarity)} · ${remaining}</span></td><td>${bonuses||'—'}<br><span class="rws-muted">${stats} · ${escapeHtml(r.compSummary||'')}</span></td><td>${fmtMoney(t.currentBid)}</td><td><strong>${fmtMoney(r.profitNow)}</strong><br><span class="rws-muted">${fmtPct(r.roiNow)}</span></td><td>${fmtMoney(r.minLegalBid)}</td><td><strong>${fmtMoney(r.recommendedMaxBid)}</strong><br><span class="rws-muted">Abs ${fmtMoney(r.absoluteMaxBid)}</span></td><td>${Number.isFinite(r.fair)?`${fmtMoney(r.low)} – ${fmtMoney(r.high)}`:'<span class="rws-warn">Insufficient</span>'}</td><td>${sanity}</td><td class="${confClass}"><span class="rws-score">${r.confidence}</span></td><td><span class="rws-score">${liq.score}</span></td><td>${escapeHtml(trend)}</td><td><span class="rws-score">${r.dealScore}</span></td></tr>${expanded?`<tr><td colspan="13">${renderDetails(r)}</td></tr>`:''}`;
    }).join('');
    return `<div class="rws-section"><div class="rws-section-head"><div><h3>Live Auction House opportunities</h3><div class="rws-section-sub">Best actionable auctions first. Tap for comparable-sale evidence.</div></div></div><div class="rws-table-wrap desktop-results"><table class="rws-table"><thead><tr><th>Decision</th><th>Item</th><th>Roll / comps</th><th>Current</th><th>Win now</th><th>Next</th><th>Good / absolute</th><th>Sold range</th><th>Current asks</th><th>Conf</th><th>Liq</th><th>Trend</th><th>Score</th></tr></thead><tbody>${rows}</tbody></table></div><div class="rws-result-cards">${cards.join('')}</div></div>`;
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds)) return '—';
    const s = Math.max(0, Math.floor(seconds));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function renderDetails(r) {
    const cp = r.confidenceParts || {};
    const comps = r.allComps || [];
    const a = r.historyAudit;
    const bonusNorm = r.bonusProfile?.length ? r.bonusProfile.map(p => `${escapeHtml(p.title)} ${Number.isFinite(p.value)?escapeHtml(p.value):''}: ${Number.isFinite(p.percentile)?`P${Math.round(p.percentile*100)} · ${escapeHtml(p.classCode)} ${escapeHtml(p.min)}-${escapeHtml(p.max)}`:'adaptive'}`).join(' · ') : '—';
    const sameUid = r.sameUidHistory?.length ? r.sameUidHistory.map(s => `${new Date(s.timestamp*1000).toLocaleDateString()} ${fmtMoney(s.price)}`).join(' → ') : 'None';
    const compRows = comps.map((c,i) => { const b=c.breakdown; const bonuses=c.bonuses.map(x=>`${escapeHtml(x.title)} ${Number.isFinite(x.value)?escapeHtml(x.value):''}`).join(' + '); const stats=Number.isFinite(c.stats.armor)?`AR ${fmtNum(c.stats.armor)}`:`${fmtNum(c.stats.damage)} / ${fmtNum(c.stats.accuracy)}`; const cls=c.matchScore>=85?'rws-good':c.matchScore>=70?'rws-warn':'rws-muted'; return `<tr><td>${i+1}</td><td class="${cls}"><strong>${c.matchScore}/100</strong><br><span class="rws-muted">${c.tier}${c.sameUid?' · SAME UID':''}</span></td><td>${fmtMoney(c.price)}</td><td>${fmtAgeDays(c.ageDays)}</td><td>${bonuses||'—'}</td><td>${stats}</td><td>${Math.round(b.item)}/${Math.round(b.rarity)}/${Math.round(b.bonus)}/${Math.round(b.roll)}/${Math.round(b.stats)}/${Math.round(b.recency)}</td></tr>`; }).join('');
    return `<div class="rws-details">
      <div class="rws-grid">
        <div class="rws-stat"><small>Fair value</small><strong>${fmtMoney(r.fair)}</strong><span class="rws-muted">${fmtMoney(r.low)}–${fmtMoney(r.high)}</span></div>
        <div class="rws-stat"><small>Profit / ROI now</small><strong>${fmtMoney(r.profitNow)} · ${fmtPct(r.roiNow)}</strong></div>
        <div class="rws-stat"><small>Confidence</small><strong>${r.confidence}/100 · ${escapeHtml(r.confidenceLabel||'')}</strong></div>
        <div class="rws-stat"><small>Liquidity</small><strong>${r.liquidity?.score??0}/100 · ${escapeHtml(r.liquidity?.label||'—')}</strong></div>
        <div class="rws-stat"><small>Comp quality</small><strong>${escapeHtml(r.compSummary||compQualitySummary(r))}</strong></div>
        <div class="rws-stat"><small>Sale speed</small><strong>${escapeHtml(r.liquidity?.speedLabel||'—')}${Number.isFinite(r.liquidity?.expectedDays)?` · ~${r.liquidity.expectedDays.toFixed(r.liquidity.expectedDays<10?1:0)}d`:''}</strong></div>
        <div class="rws-stat"><small>Trend</small><strong>${escapeHtml(r.trend?.label||'UNKNOWN')}${Number.isFinite(r.trend?.pct)?` · ${(r.trend.pct*100).toFixed(1)}%`:''}</strong></div>
        <div class="rws-stat"><small>History</small><strong>${escapeHtml(r.historyFreshness?.label||'—')}</strong><span class="rws-muted">${r.historyFreshness?.lastSync?formatAgoMs(r.historyFreshness.lastSync):''}</span></div>
        ${r.target?.source==='market'?`<div class="rws-stat"><small>Good / absolute max</small><strong>${fmtMoney(r.recommendedMaxBuy)} / ${fmtMoney(r.absoluteMaxBuy)}</strong></div>`:''}
        ${r.target?.source==='auction-live'?`<div class="rws-stat"><small>Good / absolute max bid</small><strong>${fmtMoney(r.recommendedMaxBid)} / ${fmtMoney(r.absoluteMaxBid)}</strong></div>`:''}
        <div class="rws-stat"><small>Raw → calibrated</small><strong>${fmtMoney(r.rawFair??r.fair)} → ${fmtMoney(r.fair)}</strong></div>
        <div class="rws-stat"><small>Same UID sales</small><strong>${r.sameUidHistory?.length??0}</strong></div>
      </div>
      <div class="rws-note"><strong>Decision:</strong> ${r.rejectReasons?.length?escapeHtml(r.rejectReasons.join(' · ')):'Passes configured highlight filters.'}</div>
      <details class="rws-detail-block"><summary>Pricing model & normalization</summary>
        <div class="rws-note"><strong>Bonus rolls:</strong> ${bonusNorm}</div>
        <div class="rws-note" style="margin-top:6px"><strong>Stat percentile:</strong> ${Number.isFinite(r.statProfile?.armor)?`AR P${Math.round(r.statProfile.armor*100)}`:`${Number.isFinite(r.statProfile?.damage)?`DMG P${Math.round(r.statProfile.damage*100)}`:'DMG —'} · ${Number.isFinite(r.statProfile?.accuracy)?`ACC P${Math.round(r.statProfile.accuracy*100)}`:'ACC —'}`} · ${r.statProfile?.sampleCount??0} samples.</div>
        ${r.dualBonus?.available?`<div class="rws-note" style="margin-top:6px"><strong>Dual-bonus:</strong> ${escapeHtml(r.dualBonus.source)} · ${fmtMoney(r.dualBonus.estimate)} · ${r.dualBonus.exactCount} exact combo sales.</div>`:''}
        ${r.regime?.available?`<div class="rws-note" style="margin-top:6px"><strong>Market regime:</strong> ${fmtMoney(r.regime.recentMedian)} recent vs ${fmtMoney(r.regime.olderMedian)} older · applied ${fmtPct(r.regime.appliedPct)}.</div>`:''}
        ${r.calibration?`<div class="rws-note" style="margin-top:6px"><strong>Calibration:</strong> ${escapeHtml(r.calibration.level||'segment')} · ${r.calibration.n||0} tests · MAE ${((r.calibration.maePct||0)*100).toFixed(1)}% · applied ${fmtPct(r.calibration.pct||0)}.</div>`:''}
        <div class="rws-note" style="margin-top:6px"><strong>Confidence:</strong> avg match ${cp.avgMatch??'—'} · effective N ${cp.effectiveN??'—'} · cap ${cp.confidenceCap??100}.</div>
      </details>
      <details class="rws-detail-block"><summary>History audit & exact UID</summary>
        ${a?`<div class="rws-note">Item #${escapeHtml(a.requestedItemId??r.target?.itemId??'—')} · ${a.databaseSales??a.exactItemRows} DB sales · ${a.retentionGroups??0} groups${a.newSales?` · +${a.newSales} new`:''} · ${escapeHtml(a.syncMode||'database')} · ${a.pagesFetched} page${a.pagesFetched===1?'':'s'} checked${a.mismatchedRows?` · ${a.mismatchedRows} wrong-item rejected`:''}${a.invalidRows?` · ${a.invalidRows} invalid rejected`:''}.</div>`:''}
        <div class="rws-note" style="margin-top:6px"><strong>Exact UID:</strong> ${sameUid}</div>
        <div class="rws-actions"><button class="rws-btn" data-action="rebuild-item-history" data-item-id="${escapeHtml(r.target?.itemId||'')}">Rebuild this item history</button></div>
      </details>
      <details class="rws-detail-block"><summary>Comparable sales (${comps.length})</summary><div class="rws-table-wrap"><table class="rws-table"><thead><tr><th>#</th><th>Match</th><th>Sold</th><th>Age</th><th>Bonuses</th><th>Stats</th><th>I/R/B/R/S/T</th></tr></thead><tbody>${compRows||'<tr><td colspan="7" class="rws-muted">No comparable sales above the minimum score.</td></tr>'}</tbody></table></div><div class="rws-note" style="margin-top:8px">Score = Item 30 + Rarity 20 + Bonus 20 + Roll 15 + Stats 10 + Recency 5.</div></details>
    </div>`;
  }

  function togglePanel(open) { if (open) {renderPanel();host.open();} else host.minimize(); }

  async function onClick(event) {
    const el = event.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const root = document.getElementById(rootId);

    if (action === 'main-settings') return host.settings();
    if (action === 'toggle') return togglePanel(true);
    if (action === 'close') return togglePanel(false);
    if (action === 'settings' || action === 'view-settings') { state.uiView = 'settings'; return renderPanel(); }
    if (action === 'view-sniper') { state.uiView = 'sniper'; return renderPanel(); }
    if (action === 'view-market') { state.uiView = 'market'; return renderPanel(); }
    if (action === 'view-data') { state.uiView = 'data'; return renderPanel(); }
    if (action === 'sync-umw') {
      const count = syncWatchlistFromMarketWatcher();
      setStatus(count ? `Synced ${count} enabled Market Watcher item IDs.` : 'No enabled Market Watcher watchlist entries were found.');
      renderPanel();
      return;
    }
    if (action === 'add-current') {
      const id = currentItemMarketId();
      if (!id) {
        setStatus('Open a specific Torn Item Market item first, then tap Current item.');
        renderPanel();
        return;
      }
      state.watchlist = [...new Set([...state.watchlist, id])];
      saveWatchlist();
      setStatus(`Added current Item Market item ${id}.`);
      renderPanel();
      return;
    }
    if (action === 'add-ids') {
      const input = root.querySelector('[data-role="add-ids"]');
      const ids = String(input?.value || '').match(/\d+/g)?.map(Number).filter(n => n > 0) || [];
      state.watchlist = [...new Set([...state.watchlist, ...ids.filter(Number.isSafeInteger)])].slice(0,50);
      saveWatchlist();
      renderPanel();
      return;
    }
    if (action === 'remove-id') {
      const id = Number(el.dataset.id);
      state.watchlist = state.watchlist.filter(x => x !== id);
      saveWatchlist();
      renderPanel();
      return;
    }
    if (action === 'scan') { state.uiView='market'; return scanWatchlist({ forceHistory: false }); }
    if (action === 'force-scan') { state.uiView='market'; return scanWatchlist({ forceHistory: true }); }
    if (action === 'scan-auction') { state.uiView='sniper'; return scanVisibleAuctionHouse({ forceHistory: false }); }
    if (action === 'force-scan-auction') { state.uiView='sniper'; return scanVisibleAuctionHouse({ forceHistory: true }); }
    if (action === 'demo') { state.uiView='market'; return runDemo(); }
    if (action === 'clear-cache') {
      if (state.busy || !confirm('Delete the saved RW sales database and calibration? Export a backup first if you want to keep it.')) return;
      await clearHistoryCache();
      gmDelete(STORAGE.itemDetailsCache);
      gmDelete(STORAGE.health);
      state.calibrationMemory.clear();

      state.marketSanityCache.clear();
      document.getElementById('rws-ah-summary')?.remove();
      state.uiView='data'; setStatus('Persistent sold-sales database, calibration data, UID detail cache, and health counters cleared.');
      renderPanel(); return;
    }
    if (action === 'prune-db') {
      pruneDatabaseNow();
      state.uiView='data'; setStatus('Database limits enforced and stale records pruned.');
      renderPanel();
      return;
    }
    if (action === 'clear-uid-cache') {
      gmDelete(STORAGE.itemDetailsCache);
      state.uiView='data'; setStatus('UID detail cache cleared. Sold-sales history was kept.');
      renderPanel();
      return;
    }
    if (action === 'export-db') {
      (async () => {
        try {
          const stats = await exportRwDatabase();
          setStatus(`RW DB exported: ${stats.items} item histories · ${stats.calibration} calibration segments · ${formatStorageBytes(stats.bytes)} JSON.`);
        } catch (error) { setStatus(`Export failed: ${cleanApiErrorMessage(error)}`); }
        renderPanel();
      })();
      return;
    }
    if (action === 'recalibrate-db') {
      if (state.busy) return;
      state.busy = true; renderPanel();
      (async () => {
        try {
          const count = await recalibrateEntireDatabase();
          setStatus(`Calibration backtests rebuilt for ${count} stored item histories.`);
        } catch (error) { setStatus(`Calibration failed: ${cleanApiErrorMessage(error)}`); }
        finally { state.busy = false; renderPanel(); }
      })();
      return;
    }
    if (action === 'rebuild-item-history') {
      const itemId = Number(el.dataset.itemId);
      if (!Number.isSafeInteger(itemId) || itemId <= 0) return;
      deleteHistoryItem(itemId);
      state.marketSanityCache.delete(itemId);
      setStatus(`Cleared local history for item ${itemId}; rebuilding…`);
      if (location.href.includes('amarket.php')) return scanVisibleAuctionHouse({ forceHistory: true });
      if (!state.watchlist.includes(itemId)) { state.watchlist.push(itemId); saveWatchlist(); }
      return scanWatchlist({ forceHistory: true });
    }
    if (action === 'save-key') {
      const input = root.querySelector('[data-setting="apiKey"]');
      const v = String(input?.value || '').trim();
      if (v && !/^•+$/.test(v)) setApiKey(v);
      setStatus(getApiKey() ? 'API key saved.' : 'No API key saved.');
      renderPanel();
      return;
    }
    if (action === 'clear-key') {
      setApiKey('');
      setStatus('API key cleared.');
      renderPanel();
      return;
    }
    if (action === 'save-settings') {
      readSettingsFromPanel();
      saveSettings();
      state.lastResults = state.lastResults.map(r => {
        if (r?.error) return r;
        const repriced = addDealMetrics(r);
        return applyOpportunityDecision(
          r.target?.source === 'auction-live' ? addAuctionBidMetrics(repriced) : r.target?.source === 'market' ? addMarketBuyMetrics(repriced) : repriced
        );
      });
      if (state.lastResults.some(r=>r?.target?.source==='auction-live')) { state.lastResults.sort(auctionResultSort); annotateAuctionRows(state.lastResults); }
      state.uiView='settings'; setStatus('Settings saved and existing opportunities reclassified locally.');
      renderPanel();
      return;
    }
    if (action === 'expand-result') {
      const key = el.dataset.key;
      state.expandedKey = state.expandedKey === key ? null : key;
      renderPanel();
      return;
    }
  }

  function onChange(event) {
    if (event.target.matches('[data-role="import-db-file"]')) {
      const file = event.target.files?.[0];
      if (!file) return;
      state.busy = true; setStatus('Importing and merging RW database…'); renderPanel();
      importRwDatabaseFile(file).then(result => {
        setStatus(`RW DB import complete: ${result.mergedItems} item histories merged · +${result.importedSales} new sales · ${result.rejected} rejected.`);
      }).catch(error => setStatus(`Import failed: ${cleanApiErrorMessage(error)}`)).finally(() => { state.busy = false; renderPanel(); });
      return;
    }
    if (!event.target.matches('[data-setting]:not([data-setting="apiKey"])')) return;
    const setting = event.target.getAttribute('data-setting');
    readSettingsFromPanel();
    if (setting === 'autoAuctionSniper') {
      saveSettings();
      state.autoAuctionLastSignature = '';
      if (state.settings.autoAuctionSniper) {
        setStatus('Auto AH Sniper enabled. New Auction House pages will be analyzed automatically.');
        scheduleAutoAuctionScan('enabled', 250);
      } else {
        cancelAutoAuctionTimer();
        setStatus('Auto AH Sniper disabled. Manual analysis is still available.');
      }
      renderPanel();
      return;
    }
    if (setting === 'calibrationEnabled') {
      saveSettings();
      setStatus(`Backtest calibration ${state.settings.calibrationEnabled ? 'enabled' : 'disabled'}. Existing displayed valuations update on the next scan.`);
      renderPanel();
      return;
    }
    if (['highlightDirectOnly','marketSanityEnabled'].includes(setting)) {
      saveSettings();
      // Reclassify existing results immediately; no API call needed for filter changes.
      state.lastResults = state.lastResults.map(r => {
        if (r?.error) return r;
        const next = applyOpportunityDecision(r);
        return !state.settings.marketSanityEnabled ? { ...next, marketSanity: null, marketSanityError: '' } : next;
      }).sort((a,b)=>a?.target?.source==='auction-live' ? auctionResultSort(a,b) : 0);
      if (state.lastResults.some(r=>r?.target?.source==='auction-live')) annotateAuctionRows(state.lastResults);
      renderPanel();
    }
  }

  function readSettingsFromPanel() {
    const root = document.getElementById(rootId);
    if (!root) return;
    const get = name => root.querySelector(`[data-setting="${name}"]`)?.value;
    state.settings.marketFeePct = clamp(safeNumber(get('marketFeePct'), state.settings.marketFeePct), 0, 25);
    state.settings.historyDays = Math.round(clamp(safeNumber(get('historyDays'), state.settings.historyDays), 30, 1500));
    state.settings.maxAuctionPages = Math.round(clamp(safeNumber(get('maxAuctionPages'), state.settings.maxAuctionPages), 1, 10));
    state.settings.maxMarketPages = Math.round(clamp(safeNumber(get('maxMarketPages'), state.settings.maxMarketPages), 1, 5));
    state.settings.minCompScore = clamp(safeNumber(get('minCompScore'), state.settings.minCompScore), 0, 100);
    state.settings.requestGapMs = Math.round(clamp(safeNumber(get('requestGapMs'), state.settings.requestGapMs), 250, 5000));
    state.settings.historyCacheMinutes = Math.round(clamp(safeNumber(get('historyCacheMinutes'), state.settings.historyCacheMinutes), 1, 10080));
    state.settings.historyPerItemCap = Math.round(clamp(safeNumber(get('historyPerItemCap'), state.settings.historyPerItemCap), 100, 2000));
    state.settings.historyStorageBudgetKb = Math.round(clamp(safeNumber(get('historyStorageBudgetKb'), state.settings.historyStorageBudgetKb), 256, 4096));
    state.settings.auctionTargetRoiPct = clamp(safeNumber(get('auctionTargetRoiPct'), state.settings.auctionTargetRoiPct), 0, 200);
    state.settings.auctionMinProfit = Math.max(0, Math.round(safeNumber(get('auctionMinProfit'), state.settings.auctionMinProfit)));
    state.settings.auctionSafetyPct = clamp(safeNumber(get('auctionSafetyPct'), state.settings.auctionSafetyPct), 0, 50);
    state.settings.auctionAbsoluteRoiPct = clamp(safeNumber(get('auctionAbsoluteRoiPct'), state.settings.auctionAbsoluteRoiPct), 0, 200);
    state.settings.auctionAbsoluteMinProfit = Math.max(0, Math.round(safeNumber(get('auctionAbsoluteMinProfit'), state.settings.auctionAbsoluteMinProfit)));
    state.settings.auctionAbsoluteSafetyPct = clamp(safeNumber(get('auctionAbsoluteSafetyPct'), state.settings.auctionAbsoluteSafetyPct), 0, 50);
    state.settings.auctionMinConfidence = clamp(safeNumber(get('auctionMinConfidence'), state.settings.auctionMinConfidence), 0, 100);
    state.settings.highlightMinProfit = Math.max(0, Math.round(safeNumber(get('highlightMinProfit'), state.settings.highlightMinProfit)));
    state.settings.highlightMinRoiPct = clamp(safeNumber(get('highlightMinRoiPct'), state.settings.highlightMinRoiPct), 0, 500);
    state.settings.highlightMinConfidence = clamp(safeNumber(get('highlightMinConfidence'), state.settings.highlightMinConfidence), 0, 100);
    state.settings.highlightMinLiquidity = clamp(safeNumber(get('highlightMinLiquidity'), state.settings.highlightMinLiquidity), 0, 100);
    state.settings.highlightMaxCapital = Math.max(0, Math.round(safeNumber(get('highlightMaxCapital'), state.settings.highlightMaxCapital)));
    state.settings.marketSanityCacheMinutes = Math.round(clamp(safeNumber(get('marketSanityCacheMinutes'), state.settings.marketSanityCacheMinutes), 1, 1440));
    state.settings.endingSoonMinutes = Math.round(clamp(safeNumber(get('endingSoonMinutes'), state.settings.endingSoonMinutes), 1, 120));
    state.settings.calibrationMinSamples = Math.round(clamp(safeNumber(get('calibrationMinSamples'), state.settings.calibrationMinSamples), 3, 50));
    state.settings.calibrationMaxAdjustPct = clamp(safeNumber(get('calibrationMaxAdjustPct'), state.settings.calibrationMaxAdjustPct), 0, 20);
    state.settings.calibrationBacktestPerItem = Math.round(clamp(safeNumber(get('calibrationBacktestPerItem'), state.settings.calibrationBacktestPerItem), 4, 30));
    state.settings.calibrationRefreshHours = Math.round(clamp(safeNumber(get('calibrationRefreshHours'), state.settings.calibrationRefreshHours), 1, 720));
    const calibrationEnabled = root.querySelector('[data-setting="calibrationEnabled"]');
    if (calibrationEnabled) state.settings.calibrationEnabled = !!calibrationEnabled.checked;
    const directOnly = root.querySelector('[data-setting="highlightDirectOnly"]');
    if (directOnly) state.settings.highlightDirectOnly = !!directOnly.checked;
    const marketSanity = root.querySelector('[data-setting="marketSanityEnabled"]');
    if (marketSanity) state.settings.marketSanityEnabled = !!marketSanity.checked;
    const autoAuction = root.querySelector('[data-setting="autoAuctionSniper"]');
    if (autoAuction) state.settings.autoAuctionSniper = !!autoAuction.checked;
  }

  // ---------------------------------------------------------------------------
  // Self-tests / integration hooks for later transplant into the main watcher
  // ---------------------------------------------------------------------------

  function runSelfTests() {
    const now = Math.floor(Date.now() / 1000);
    const t = {
      itemId: 10, rarity: 'Yellow', stats: { damage: 70, accuracy: 60, armor: null },
      bonuses: [{ title: 'Sure Shot', value: 8 }],
    };
    const identical = {
      itemId: 10, rarity: 'Yellow', stats: { damage: 70, accuracy: 60, armor: null },
      bonuses: [{ title: 'Sure Shot', value: 8 }], timestamp: now, price: 100,
    };
    const bad = {
      itemId: 10, rarity: 'Orange', stats: { damage: 50, accuracy: 40, armor: null },
      bonuses: [{ title: 'Deadeye', value: 30 }], timestamp: now - 400 * 86400, price: 100,
    };
    const exactScore = scoreComparable(t, identical);
    const a = exactScore.matchScore;
    const b = scoreComparable(t, bad).matchScore;
    if (a < 99 || b >= a || exactScore.tier !== 'DIRECT') throw new Error(`RW Scout self-test failed: identical=${a}, weak=${b}, tier=${exactScore.tier}`);

    const syntheticHistory = Array.from({ length: 8 }, (_, i) => ({
      ...identical,
      uid: String(100 + i),
      timestamp: now - i * 7 * 86400,
      price: 300000000 + i * 3000000,
      stats: { damage: 70 + i * 0.05, accuracy: 60 + i * 0.05, armor: null },
      bonuses: [{ title: 'Sure Shot', value: 8 + i * 0.03 }],
    }));
    const val = addAuctionBidMetrics(addDealMetrics(buildValuation({ ...t, source: 'auction-live', uid: '999', currentBid: 200000000, price: 200000000 }, syntheticHistory)));
    if (!(val.recommendedMaxBid > 0) || !(val.absoluteMaxBid >= val.recommendedMaxBid) || !(val.liquidity?.score >= 0)) {
      throw new Error('RW Scout self-test failed: dual ceilings/liquidity');
    }
    const decided = applyOpportunityDecision(val);
    if (!decided.opportunityClass || !Number.isFinite(decided.roiNow) || !decided.compSummary) {
      throw new Error('RW Scout self-test failed: decision metrics');
    }
    const sanity = buildMarketSanity(t, [{ ...identical, source:'market', uid:'other', price:110, timestamp:undefined }, { ...identical, source:'market', uid:'other2', price:112, timestamp:undefined }], 100);
    if (!sanity.available || sanity.count < 2) throw new Error('RW Scout self-test failed: current market sanity');
    const ssYellow = resolveBonusRange({ ...t, rarity:'Yellow' }, { title:'Sure Shot', value:4 });
    const ssOrange = resolveBonusRange({ ...t, rarity:'Orange' }, { title:'Sure Shot', value:7 });
    if (!ssYellow || ssYellow.classCode !== 'Y' || ssYellow.percentile < .9 || !ssOrange || ssOrange.classCode !== 'O') throw new Error('RW Scout self-test failed: official bonus normalization');
    const statCtx = buildStatContext(t, syntheticHistory);
    const statProfile = targetStatProfile(t, statCtx);
    if (statCtx.sampleCount < 6 || !Number.isFinite(statProfile.damage)) throw new Error('RW Scout self-test failed: stat percentiles');
    const dualTarget = { ...t, rarity:'Orange', bonuses:[{title:'Sure Shot',value:7},{title:'Warlord',value:24}] };
    const dualHistory = Array.from({length:12},(_,i)=>({ ...identical, rarity:'Orange', timestamp:Math.floor(Date.now()/1000)-i*86400, price:300000000+i*3000000,
      bonuses:i<4?[{title:'Sure Shot',value:6+i%2},{title:'Warlord',value:23+i%2}]:i<8?[{title:'Sure Shot',value:6+i%2},{title:'Focus',value:22}]:[{title:'Warlord',value:23+i%2},{title:'Powerful',value:28}] }));
    const dual = calculateDualBonusModel(dualTarget, dualHistory);
    if (!dual?.available || !(dual.estimate > 0)) throw new Error('RW Scout self-test failed: dual bonus model');
    const calDown = calibrationAdjustment({ n: 12, sumLogError: 12 * Math.log(.94), sumAbsPct: .72, sumPct: -.72 });
    if (!(calDown.factor < 1) || Math.abs(calDown.pct) > state.settings.calibrationMaxAdjustPct / 100 + 1e-9) throw new Error('RW Scout self-test failed: calibration bounds');
    const packedTest = packHistoryBundle({ requestedItemId:399, sales:[{ ...identical, itemId:399, timestamp:now-86400, price:321000000 }], savedAt:Date.now() });
    const unpackedTest = unpackHistoryBundle(packedTest,399);
    if (!unpackedTest?.sales?.length || unpackedTest.sales[0].price !== 321000000) throw new Error('RW Scout self-test failed: compact DB round trip');
    return true;
  }

  return {
    mountInto(container) { const root=mount(); container.append(root); if (!root.firstElementChild) renderPanel(); },
    initialize() {
      mount();
      state.dbReadyPromise = initializeRwDatabase().then(ok => {
        enforceHistoryStorageBudget();
        setStatus(ok ? 'Saved sales database ready.' : 'Local storage fallback: '+state.dbError);
        renderPanel(); return ok;
      });
      startAutoAuctionObserver();
    },
    resume() { scheduleAutoAuctionScan('watcher ready', 500); },
  };
}

  async function init() {
    await waitForBody();
    initializeCredentials();
    installAccessibilityStyles();

    ensureBadge();
    ensureToastWrap();
    updateBadge();
    rebuildDebugPanel();

    getRwModule().initialize();
    startListingFocus();
    window.addEventListener('hashchange',()=>startListingFocus());
    await ensureMembershipReady();
    startMembershipRefreshLoop();

    setInterval(() => {
      try {
        ensureBadge();
        updateBadge();
      } catch (err) {
        console.error('[UMW] Badge refresh failed:', err);
      }
    }, 2000);

    const storedApiKey = getEffectiveApiKey();
    if (!storedApiKey) {
      setLastError('No stored Torn API key. Register from the Membership section.');
    }

    tryBecomeLeader();

    setInterval(maintainLeadership, HEARTBEAT_MS);

    (async function dynamicPollLoop() {
      while (true) {
        try {
          if (isLeader && isEnabled() && isMembershipActive()) {
            await runLoop();
          }
        } catch (err) {
          setLastError(err.message || String(err));
        }
        await sleep(getSettings().pollMs);
      }
    })();

    if (isLeader && isEnabled() && isMembershipActive()) {
      await runLoop();
    }

    window.addEventListener('beforeunload', releaseLeadership);
    window.addEventListener('pagehide', () => { pageSuspended = true; releaseLeadership(); });
    window.addEventListener('pageshow', () => { pageSuspended = false; maintainLeadership(); });
    window.addEventListener('storage', event => {
      if ([FEATURE_KEYS.snoozes, FEATURE_KEYS.prices].includes(event.key)) requestDebugPanelRefresh();
      if (event.key === null || [STORAGE_KEYS.enabled, STORAGE_KEYS.settings, STORAGE_KEYS.watchlist,
        MEMBERSHIP_KEYS.playerId, MEMBERSHIP_KEYS.apiKey, MEMBERSHIP_KEYS.lastAuthStatus, FEATURE_KEYS.groups, LOCK_KEY].includes(event.key)) {
        cancelScans(); invalidateRuntimeCache();
        if (event.key === MEMBERSHIP_KEYS.playerId || event.key === MEMBERSHIP_KEYS.apiKey || event.key === null) {
          authRevision++; sessionApiKey = ''; membershipState.active = false;
          initializeCredentials();
          if (getEffectiveApiKey() && getStoredPlayerId()) ensureMembershipReady();
        }
        updateBadge(); requestDebugPanelRefresh();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init().catch(err => setLastError(err.message || String(err)));
    });
  } else {
    init().catch(err => setLastError(err.message || String(err)));
  }
})();
