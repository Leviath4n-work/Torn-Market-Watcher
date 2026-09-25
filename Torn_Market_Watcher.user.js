// ==UserScript==
// @name         TornPDA Universal Market Watcher
// @namespace    leviath4n.torn.marketwatch.v6.7.2
// @version      7.1.2
// @description  Market watcher with a mobile-first dashboard, inline filters, presets, alert history, and HTTP-compatible membership.
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
      return (typeof GM_info !== 'undefined' && GM_info?.script?.version) ? GM_info.script.version : '7.1.2';
    } catch {
      return '7.1.2';
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
  }
}

  function setWatcherEnabledState(value) {
    const next = !!value;
    setEnabled(next);
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

function showDesktopNotification(title, body, url) {
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
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
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
      payload = { ...first.payload, matchCount: chosen.length, priceHigh: high, summaries,
        formatted: { ...first.payload.formatted,
          text: chosen.length + ' matching listings · ' + uiMoney(low) + (high !== low ? '–' + uiMoney(high) : '') + ' · Open Alerts for details' } };
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
    const title = uiNode('div'); title.append(uiNode('h1', '', 'Market Watcher'), uiNode('span', 'umw-muted', 'Good deals. Less guesswork.'));
    brand.append(title);
    const close = uiButton('×', () => { setDebugVisible(false); rebuildDebugPanel(); updateBadge(); badgeEl?.focus(); }, 'umw-icon-button');
    close.setAttribute('aria-label', 'Close Market Watcher'); close.dataset.close = '';
    header.append(brand, close); debugPanelEl.append(header);

    const overview = uiNode('div', 'umw-overview'); const state = uiStatus(); overview.dataset.tone = state.tone;
    const statusCopy = uiNode('div'); const statusLine = uiNode('div', 'umw-status-line');
    statusLine.append(uiNode('span', 'umw-dot'), uiNode('strong', '', state.label));
    statusCopy.append(statusLine, uiNode('p', 'umw-muted', state.detail));
    const pause = uiButton(isEnabled() ? 'Pause watcher' : 'Resume watcher', () => { unlockAudioContext(); setWatcherEnabledState(!isEnabled()); }, isEnabled() ? '' : 'umw-primary');
    overview.append(statusCopy, pause); debugPanelEl.append(overview);

    const nav = uiNode('nav', 'umw-tabs'); nav.setAttribute('aria-label', 'Watcher views');
    for (const [key, label, count] of [['watchlist','Watchlist',model.watchlist.length],['alerts','Alerts',model.popupHistory.length],['settings','Settings',null]]) {
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
    else renderSettingsView(content, model);
    for (const detail of content.querySelectorAll('details')) detail.open = expandedDetails.has(detail.dataset.detailKey || detail.className + ':' + detail.querySelector('summary')?.textContent);
    debugPanelEl.append(content);
    const footer = uiNode('footer', 'umw-footer'); footer.append(uiNode('span', '', 'Last scan · ' + formatElapsedSince(model.lastScanAt)), uiNode('span', '', 'v' + getScriptVersion()));
    debugPanelEl.append(footer); content.scrollTop = force ? 0 : scroll;
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
    const card=uiNode('article','umw-item');card.dataset.enabled=String(isRuleScanning(rule));
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
    const bar=uiNode('div','umw-toolbar');bar.append(uiHeading('Recent matches','Your last 3 hours of alerts. Opening a match takes you to Torn\u2019s item market.'));
    if(model.popupHistory.length)bar.append(uiButton('Clear history',()=>{if(window.confirm('Clear recent alert history?'))clearPopupHistory();}));container.append(bar);
    if(!model.popupHistory.length){container.append(uiEmpty('All quiet for now','Matches will appear here when an item meets your filters. Keep the watcher enabled and this browser open.'));return;}
    for(const entry of model.popupHistory){
      const card=uiNode('article','umw-history');const row=uiNode('div','umw-toolbar');const title=uiNode('div');title.append(uiNode('span','umw-eyebrow',entry.tier==='insane'?'EXCEPTIONAL MATCH':entry.tier==='strong'?'STRONG MATCH':'MARKET MATCH'),uiNode('h3','',entry.itemName||'Item #'+entry.itemId));
      if(Number(entry.matchCount)>1) title.append(uiNode('span','umw-chip',entry.matchCount+' matching listings'));
      row.append(title,uiNode('strong','umw-price',uiMoney(entry.price)+(entry.priceHigh>entry.price?'–'+uiMoney(entry.priceHigh):'')));card.append(row,uiNode('p','umw-muted',entry.text||''));
      if(Array.isArray(entry.summaries)&&entry.summaries.length){const detail=uiNode('details','umw-digest-detail');detail.dataset.detailKey='digest:'+entry.itemId+':'+entry.at;detail.append(uiNode('summary','','Preview '+entry.summaries.length+' of '+entry.matchCount+' matches'));for(const text of entry.summaries)detail.append(uiNode('p','umw-muted',text));card.append(detail);}
      const foot=uiNode('div','umw-item-bottom');foot.append(uiNode('span','umw-muted',formatElapsedSince(entry.at)),uiButton('View on market ↗',()=>{location.href=buildMarketUrl(Number(entry.itemId));},'umw-text-button'));card.append(foot);container.append(card);
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


async function apiFetch(url, revision = scanRevision) {
    const operation = apiQueue.then(async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (revision !== null) assertScan(revision);
        const backoff = getNumber('umw_api_backoff_v680', 0);
        if (now() < backoff) throw new Error('API cooling down; retry on a later scan.');
        await sleep(Math.max(0, getNumber('umw_api_next_v680', 0) - now()));
        if (revision !== null) assertScan(revision);
        localStore.setItem('umw_api_next_v680', String(now() + 1250));
        try {
          return await gmRequestJson('GET', url, null, revision !== null);
        } catch (error) {
          if (error.cancelled) throw error;
          if ([1, 2, 10, 13, 16, 18].includes(error.code)) {
            if (revision !== null) { setEnabled(false); setStoredApiKey(''); }
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
    if (payload?.matchCount > 1) {
      designState.tab = 'alerts'; setDebugVisible(true); rebuildDebugPanel();
    } else location.href = url;
  }, payload?.matchCount > 1 ? 'Open match digest in Alerts' : undefined);

  showDesktopNotification(title, formatted.text, url);
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

  async function init() {
    await waitForBody();
    initializeCredentials();
    installAccessibilityStyles();

    ensureBadge();
    ensureToastWrap();
    updateBadge();
    rebuildDebugPanel();

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
