// ==UserScript==
// @name         TornPDA Universal Market Watcher
// @namespace    leviath4n.torn.marketwatch.v6.7.0
// @version      6.7.0
// @description  Multi-item Torn market watcher with refactored state/render pipeline, server-gated membership, stored user API scanning, watchlists, debug menu, tiers, sound, vibration, persistent popups, and armor/quality filters
// @author       Leviath4n

// @updateURL   https://raw.githubusercontent.com/Leviath4n-work/Torn-Market-Watcher/main/Torn_Market_Watcher.user.js
// @downloadURL https://raw.githubusercontent.com/Leviath4n-work/Torn-Market-Watcher/main/Torn_Market_Watcher.user.js

// @match        https://www.torn.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_info
// @connect      api.torn.com
// @connect      torn.com
// @connect      146.190.216.11
// ==/UserScript==

(function () {
  'use strict';

  function getScriptVersion() {
    try {
      return (typeof GM_info !== 'undefined' && GM_info?.script?.version) ? GM_info.script.version : 'unknown';
    } catch {
      return 'unknown';
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
      stealCompMaxMultiplier: 1.18,
      allowFallbackCompEstimate: true
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
    }
  });

  console.log(`[UMW v${SCRIPT_VERSION}] Script booting on`, window.location.href);
  window.addEventListener('error', (e) => {
    try { console.error('[UMW] Window error:', e.error || e.message || e); } catch {}
  });
  window.addEventListener('unhandledrejection', (e) => {
    try { console.error('[UMW] Unhandled rejection:', e.reason || e); } catch {}
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
  const STEAL_COMP_MAX_MULTIPLIER = APP_CONFIG.market.stealCompMaxMultiplier;
  const ALLOW_FALLBACK_COMP_ESTIMATE = APP_CONFIG.market.allowFallbackCompEstimate;

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
    seenMap: null
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
    membershipState,
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
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function setJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function getNumber(key, fallback = 0) {
    const raw = localStorage.getItem(key);
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  function setNumber(key, value) {
    localStorage.setItem(key, String(value));
  }

  const storage = {
    getJson,
    setJson,
    getNumber,
    setNumber,
    getString(key, fallback = '') {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : String(raw);
    },
    setString(key, value) {
      localStorage.setItem(key, String(value ?? ''));
    },
    remove(key) {
      localStorage.removeItem(key);
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
        return storage.getString(MEMBERSHIP_KEYS.apiKey, '');
      },
      setApiKey(apiKey) {
        storage.setString(MEMBERSHIP_KEYS.apiKey, apiKey || '');
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

  function getStoredApiKey() {
    return storage.membership.getApiKey();
  }

  function setStoredApiKey(apiKey) {
    storage.membership.setApiKey(apiKey);
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
    return !!membershipState.active;
  }

  function applyMembershipState(status) {
    invalidateRuntimeCache('settings');
    membershipState = {
      checked: true,
      active: !!status?.active,
      playerId: String(status?.playerId || getStoredPlayerId() || ''),
      playerName: String(status?.playerName || getStoredPlayerName() || ''),
      expiresAt: Number(status?.expiresAt || 0),
      msLeft: Number(status?.msLeft || 0),
      reason: String(status?.reason || '')
    };

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

  function gmRequestJson(method, url, body = null) {
    return new Promise((resolve, reject) => {
      const options = {
        method,
        url,
        headers: {},
        onload: (res) => {
          try {
            if (res.status < 200 || res.status >= 300) {
              reject(new Error(`HTTP ${res.status}`));
              return;
            }

            const data = JSON.parse(res.responseText);
            if (data?.ok === false) {
              reject(new Error(data?.error || 'Request failed'));
              return;
            }

            resolve(data);
          } catch (err) {
            reject(err);
          }
        },
        onerror: () => reject(new Error('GM_xmlhttpRequest failed'))
      };

      if (body !== null) {
        options.headers['Content-Type'] = 'application/json';
        options.data = JSON.stringify(body);
      }

      GM_xmlhttpRequest(options);
    });
  }

  async function backendPost(path, body) {
    return gmRequestJson('POST', `${BACKEND_BASE_URL}${path}`, body);
  }

  async function backendGet(path) {
    return gmRequestJson('GET', `${BACKEND_BASE_URL}${path}`);
  }

  async function detectApiKeyType(apiKey) {
    try {
      const normalizedApiKey = String(apiKey || '').trim();
      const res = await fetch(`https://api.torn.com/user/?selections=log&key=${encodeURIComponent(normalizedApiKey)}`, {
        method: 'GET'
      });
      const data = await res.json();

      if (data?.error) {
        return 'limited';
      }

      return 'full';
    } catch (err) {
      console.error('[UMW] Key detection failed:', err);
      return 'unknown';
    }
  }

  async function registerWithServer(apiKey) {
    const normalizedApiKey = String(apiKey || '').trim();
    const data = await backendPost('/register', { apiKey: normalizedApiKey });

    setStoredPlayerId(data.playerId);
    setStoredPlayerName(data.playerName);
    setStoredApiKey(normalizedApiKey);

    return data;
  }

  async function checkAuthStatus(playerId) {
    const data = await backendGet(`/auth-status?playerId=${encodeURIComponent(playerId)}`);
    setLastAuthStatus(data);
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
      console.error('[UMW] Membership check failed:', err);
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
      console.error('[UMW] Membership refresh failed:', err);
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
      message: message || '',
      at: now()
    };
    localStorage.setItem(STORAGE_KEYS.lastError, JSON.stringify(payload));
    requestDebugPanelRefresh();
}

  function setLastAlert(message) {
    const payload = {
      message: message || '',
      at: now()
    };
    localStorage.setItem(STORAGE_KEYS.lastAlert, JSON.stringify(payload));
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
  const raw = localStorage.getItem(key);
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
    url: String(entry?.url || ''),
    count: 1
  };

  const existingIndex = entries.findIndex(existing => {
    if (!existing) return false;

    const existingFingerprint = String(existing.fingerprint || '');
    const normalizedFingerprint = String(normalized.fingerprint || '');

    if (normalizedFingerprint && existingFingerprint) {
      return existingFingerprint === normalizedFingerprint;
    }

    return (
      Number(existing.itemId || 0) === normalized.itemId &&
      String(existing.text || '') === normalized.text &&
      String(existing.url || '') === normalized.url
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

function hasRecentPopupFingerprint(fingerprint) {
  const normalizedFingerprint = String(fingerprint || '').trim();
  if (!normalizedFingerprint) return false;

  const entries = prunePopupHistory(loadPopupHistory());
  return entries.some(entry => String(entry?.fingerprint || '').trim() === normalizedFingerprint);
}

function shouldSuppressPopupAlert(match, formatted, url) {
  const normalizedFingerprint = String(match?.fingerprint || '').trim();
  if (normalizedFingerprint && hasRecentPopupFingerprint(normalizedFingerprint)) {
    return true;
  }

  const entries = prunePopupHistory(loadPopupHistory());
  const normalizedText = String(formatted?.text || '').trim();
  const normalizedUrl = String(url || '').trim();
  const normalizedItemId = Number(match?.itemRule?.itemId || 0);

  return entries.some(entry =>
    Number(entry?.itemId || 0) === normalizedItemId &&
    String(entry?.text || '').trim() === normalizedText &&
    String(entry?.url || '').trim() === normalizedUrl
  );
}

function sanitizeImportedWatchRule(rawRule, fallbackIndex = 0) {
  if (!rawRule || typeof rawRule !== 'object') return null;

  const itemId = Number(rawRule.itemId);
  if (!Number.isFinite(itemId) || itemId <= 0) return null;

  const catalogItem = ITEM_CATALOG.find(item => item.itemId === itemId);
  const rawName = String(rawRule.rawName || catalogItem?.rawName || '').trim();
  const displayName = String(rawRule.displayName || catalogItem?.displayName || prettifyCatalogName(rawName || `item_${itemId}`)).trim();

  return {
    id: String(rawRule.id || `watch_${itemId}_${Date.now()}_${fallbackIndex}`),
    itemId,
    rawName: rawName || displayName.toLowerCase().replace(/\s+/g, '_'),
    displayName,
    enabled: typeof rawRule.enabled === 'boolean' ? rawRule.enabled : true,
    useMV: typeof rawRule.useMV === 'boolean' ? rawRule.useMV : true,
    maxMultiplier: Number.isFinite(Number(rawRule.maxMultiplier)) ? Number(rawRule.maxMultiplier) : 1.10,
    minArmor: rawRule.minArmor === '' || rawRule.minArmor === null || typeof rawRule.minArmor === 'undefined'
      ? ''
      : String(rawRule.minArmor),
    minQuality: rawRule.minQuality === '' || rawRule.minQuality === null || typeof rawRule.minQuality === 'undefined'
      ? ''
      : String(rawRule.minQuality),
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

  const replaceAll = window.confirm(
    'Import filters: click OK to replace your current watchlist, or Cancel to merge imported filters into it.'
  );

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
    const raw = localStorage.getItem(STORAGE_KEYS.enabled);
    if (raw === null) return true;
    return raw === 'true';
  }

  function setEnabled(value) {
  localStorage.setItem(STORAGE_KEYS.enabled, value ? 'true' : 'false');

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
    return localStorage.getItem(STORAGE_KEYS.debugVisible) === 'true';
  }

  function setDebugVisible(value) {
    localStorage.setItem(STORAGE_KEYS.debugVisible, value ? 'true' : 'false');
  }

  function isDebugPanelMinimized() {
    return localStorage.getItem(STORAGE_KEYS.debugPanelMinimized) === 'true';
  }

  function setDebugPanelMinimized(value) {
    localStorage.setItem(STORAGE_KEYS.debugPanelMinimized, value ? 'true' : 'false');
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
    if (!debugPanelEl || !handleEl) return;

    handleEl.style.cursor = 'move';
    handleEl.style.userSelect = 'none';

    const startDrag = (clientX, clientY) => {
      const rect = debugPanelEl.getBoundingClientRect();
      const offsetX = clientX - rect.left;
      const offsetY = clientY - rect.top;

      const move = (moveX, moveY) => {
        const clamped = clampDebugPanelPos(moveX - offsetX, moveY - offsetY);
        debugPanelEl.style.left = `${clamped.left}px`;
        debugPanelEl.style.top = `${clamped.top}px`;
        debugPanelEl.style.transform = 'none';
      };

      const onMouseMove = (e) => move(e.clientX, e.clientY);
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        saveDebugPanelPos({
          left: parseFloat(debugPanelEl.style.left) || rect.left,
          top: parseFloat(debugPanelEl.style.top) || rect.top
        });
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    handleEl.onmousedown = (e) => {
      if (e.target && e.target.closest('button, input, textarea, select, label')) return;
      e.preventDefault();
      startDrag(e.clientX, e.clientY);
    };
  }

function getSettings() {
  return storage.settings.get();
}

  function saveSettings(settings) {
    storage.settings.save(settings);
    requestDebugPanelRefresh(true);
  }

  function getWatchlist() {
    return storage.watchlist.get();
  }

  function saveWatchlist(list) {
    storage.watchlist.save(list);
    requestDebugPanelRefresh(true);
  }

  function prettifyCatalogName(raw) {
    return raw
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  function parseCatalog(rawText) {
    const lines = rawText
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);

    const items = [];

    for (const line of lines) {
      const match = line.match(/^(.*)\s+(\d+)$/);
      if (!match) continue;

      const rawName = match[1].trim();
      const itemId = Number(match[2]);

      if (!rawName || !Number.isFinite(itemId)) continue;

      items.push({
        rawName,
        displayName: prettifyCatalogName(rawName),
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

    const badgeWrap = document.createElement('div');
    badgeWrap.id = 'umw-badge-wrap';
    badgeWrap.style.position = 'fixed';
    badgeWrap.style.left = '12px';
    badgeWrap.style.bottom = '12px';
    badgeWrap.style.zIndex = '999999';
    badgeWrap.style.display = 'flex';
    badgeWrap.style.alignItems = 'center';
    badgeWrap.style.gap = '6px';

    badgeEl = document.createElement('div');
    badgeEl.id = 'umw-badge';
    badgeEl.style.width = '34px';
    badgeEl.style.height = '34px';
    badgeEl.style.borderRadius = '999px';
    badgeEl.style.display = 'flex';
    badgeEl.style.alignItems = 'center';
    badgeEl.style.justifyContent = 'center';
    badgeEl.style.color = '#fff';
    badgeEl.style.fontSize = '16px';
    badgeEl.style.lineHeight = '1';
    badgeEl.style.border = '1px solid rgba(255,255,255,0.12)';
    badgeEl.style.boxShadow = '0 4px 14px rgba(0,0,0,0.28)';
    badgeEl.style.cursor = 'pointer';
    badgeEl.style.userSelect = 'none';
    badgeEl.style.fontFamily = 'system-ui, sans-serif';

    const debugToggleEl = document.createElement('button');
    debugToggleEl.type = 'button';
    debugToggleEl.id = 'umw-debug-toggle';
    debugToggleEl.textContent = '^';
    debugToggleEl.style.width = '24px';
    debugToggleEl.style.height = '24px';
    debugToggleEl.style.borderRadius = '999px';
    debugToggleEl.style.display = 'flex';
    debugToggleEl.style.alignItems = 'center';
    debugToggleEl.style.justifyContent = 'center';
    debugToggleEl.style.color = '#fff';
    debugToggleEl.style.fontSize = '12px';
    debugToggleEl.style.lineHeight = '1';
    debugToggleEl.style.border = '1px solid rgba(255,255,255,0.12)';
    debugToggleEl.style.background = UI_THEME.mutedBtnBg;
    debugToggleEl.style.boxShadow = '0 4px 14px rgba(0,0,0,0.28)';
    debugToggleEl.style.cursor = 'pointer';
    debugToggleEl.style.userSelect = 'none';
    debugToggleEl.style.padding = '0';

    const handleBadgeClick = () => {
      unlockAudioContext();
      setWatcherEnabledState(!isEnabled());
    };

    const handleDebugToggle = (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDebugVisible(!isDebugVisible());
      rebuildDebugPanel();
      updateBadge();
    };

    bindClick(badgeEl, handleBadgeClick);
    bindClick(debugToggleEl, handleDebugToggle);

    badgeWrap.appendChild(badgeEl);
    badgeWrap.appendChild(debugToggleEl);

    (document.body || document.documentElement).appendChild(badgeWrap);
    console.log('[UMW] Badge injected');
  }

  function updateBadge() {
    ensureBadge();

    if (!isEnabled()) {
      badgeEl.textContent = 'OFF';
      badgeEl.style.background = 'rgba(0,0,0,0.88)';
      badgeEl.title = 'Watcher OFF. Click to turn ON. Use the small arrow button for the menu.';
      return;
    }

    if (!membershipState.active) {
      badgeEl.textContent = 'MEM';
      badgeEl.style.background = 'rgba(120,90,18,0.95)';
      badgeEl.title = 'Membership inactive. Register your API key and send 1 Xanax to Leviathan [3634894]. Use the small arrow button for the menu.';
      return;
    }

    if (!isLeader) {
      badgeEl.textContent = 'ON';
      badgeEl.style.background = 'rgba(18,120,48,0.95)';
      badgeEl.title = 'Watcher ON. Another page is scanning. Click to turn OFF. Use the small arrow button for the menu.';
      return;
    }

    badgeEl.textContent = 'ON';
    badgeEl.style.background = 'rgba(18,120,48,0.95)';
    badgeEl.title = 'Watcher ON. Click to turn OFF. Use the small arrow button for the menu.';
  }

  function ensureToastWrap() {
    if (toastWrap && document.body.contains(toastWrap)) return;

    toastWrap = document.createElement('div');
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
    notifBtn.textContent = 'Disable notifications';
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
    next.desktopNotificationsEnabled = false;
    saveSettings(next);
    syncDesktopNotificationControls(notifLabel, notifBtn);
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
      tag: 'umw-market-alert',
      requireInteraction: false
    });

    n.onclick = () => {
      try {
        window.focus();
        if (url) window.open(url, '_blank');
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

    const safeVolume = Math.max(0, Math.min(3, Number(volume) || 0.03));

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
    const volumeMul = Math.max(0, Math.min(3, (Number(settings.soundVolume) || 100) / 100));
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
  function showToast(title, text, tier, onOpen) {
    if (!isEnabled()) return;

    ensureToastWrap();

    const style = getTierStyle(tier);

    const el = document.createElement('div');
    el.style.background = style.background;
    el.style.color = '#fff';
    el.style.padding = '8px 10px';
    el.style.borderRadius = '10px';
    el.style.border = `1px solid ${style.border}`;
    el.style.boxShadow = '0 3px 10px rgba(0,0,0,0.30)';
    el.style.fontSize = '11px';
    el.style.lineHeight = '1.2';
    el.style.pointerEvents = 'auto';
    el.style.transition = 'all 0.18s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    el.style.fontFamily = 'system-ui, sans-serif';

    const topRow = document.createElement('div');
    topRow.style.display = 'flex';
    topRow.style.alignItems = 'flex-start';
    topRow.style.justifyContent = 'space-between';
    topRow.style.gap = '8px';

    const contentWrap = document.createElement('div');
    contentWrap.style.flex = '1';
    contentWrap.style.cursor = 'pointer';

    const h = document.createElement('div');
    h.style.fontWeight = '700';
    h.style.marginBottom = '2px';
    h.style.fontSize = '11px';
    h.textContent = `${style.title} | ${title}`;

    const b = document.createElement('div');
    b.style.fontSize = '11px';
    b.textContent = text;

    contentWrap.appendChild(h);
    contentWrap.appendChild(b);

    const closeBtn = createActionButton('X', null, {
      background: 'transparent',
      border: 'none',
      padding: '0 2px',
      fontSize: '14px'
    });
    closeBtn.style.lineHeight = '1';
    closeBtn.style.opacity = '0.85';

    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removePopup(el);
    });

    contentWrap.addEventListener('click', () => {
      try {
        onOpen();
      } catch (e) {
        console.error(e);
      }
      removePopup(el);
    });

    topRow.appendChild(contentWrap);
    topRow.appendChild(closeBtn);
    el.appendChild(topRow);

    toastWrap.appendChild(el);

    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    });

    vibrateForTier(tier);
    soundForTier(tier);
  }

  function ensureDebugPanel() {
    if (debugPanelEl && document.body.contains(debugPanelEl)) return;

    debugPanelEl = document.createElement('div');
    debugPanelEl.id = 'umw-debug-panel';
    debugPanelEl.style.position = 'fixed';
    debugPanelEl.style.left = '50%';
    debugPanelEl.style.top = '50%';
    debugPanelEl.style.transform = 'translate(-50%, -50%)';
    debugPanelEl.style.zIndex = '999998';
    debugPanelEl.style.width = '330px';
    debugPanelEl.style.height = 'min(75vh, 760px)';
    debugPanelEl.style.minWidth = '330px';
    debugPanelEl.style.minHeight = '180px';
    debugPanelEl.style.maxWidth = 'calc(100vw - 20px)';
    debugPanelEl.style.background = 'rgba(10,10,10,0.96)';
    debugPanelEl.style.color = '#fff';
    debugPanelEl.style.border = '1px solid rgba(255,255,255,0.12)';
    debugPanelEl.style.borderRadius = '12px';
    debugPanelEl.style.padding = '10px';
    debugPanelEl.style.fontSize = '11px';
    debugPanelEl.style.lineHeight = '1.25';
    debugPanelEl.style.boxShadow = '0 4px 18px rgba(0,0,0,0.35)';
    debugPanelEl.style.whiteSpace = 'normal';
    debugPanelEl.style.fontFamily = 'system-ui, sans-serif';
    debugPanelEl.style.maxHeight = 'calc(100vh - 20px)';
    debugPanelEl.style.overflow = 'auto';
    debugPanelEl.style.resize = 'both';
    debugPanelEl.style.boxSizing = 'border-box';

    debugPanelEl.addEventListener('mouseup', () => {
      saveDebugPanelSize({
        width: debugPanelEl.offsetWidth,
        height: debugPanelEl.offsetHeight
      });
    });

    (document.body || document.documentElement).appendChild(debugPanelEl);

    const savedSize = getDebugPanelSize();
    if (savedSize) {
      applyDebugPanelSize(savedSize);
    }

    const savedPos = getDebugPanelPos();
    if (savedPos) {
      applyDebugPanelPos(savedPos);
    }
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

  window.addEventListener('resize', () => {
    if (!debugPanelEl || !document.body.contains(debugPanelEl)) return;

    applyDebugPanelSize({
      width: debugPanelEl.offsetWidth,
      height: debugPanelEl.offsetHeight
    });

    const left = parseFloat(debugPanelEl.style.left);
    const top = parseFloat(debugPanelEl.style.top);

    if (Number.isFinite(left) && Number.isFinite(top)) {
      const clamped = clampDebugPanelPos(left, top);
      debugPanelEl.style.left = `${clamped.left}px`;
      debugPanelEl.style.top = `${clamped.top}px`;
      saveDebugPanelPos(clamped);
    }
  });


  function applyButtonBaseStyle(buttonEl, options = {}) {
    buttonEl.type = options.type || 'button';
    buttonEl.style.background = options.background || UI_THEME.mutedBtnBg;
    buttonEl.style.color = options.color || UI_THEME.strongText;
    buttonEl.style.border = options.border || UI_THEME.mutedBtnBorder;
    buttonEl.style.borderRadius = options.borderRadius || '8px';
    buttonEl.style.padding = options.padding || '5px 9px';
    buttonEl.style.cursor = 'pointer';
    buttonEl.style.fontSize = options.fontSize || '11px';
    buttonEl.style.fontWeight = options.fontWeight || '600';
    buttonEl.style.lineHeight = options.lineHeight || '1.15';
    buttonEl.style.transition = 'background 0.14s ease, border-color 0.14s ease, opacity 0.14s ease, transform 0.14s ease';
    buttonEl.style.boxShadow = options.boxShadow || 'none';
    if (options.minWidth) buttonEl.style.minWidth = options.minWidth;
    if (options.width) buttonEl.style.width = options.width;
    if (options.marginBottom) buttonEl.style.marginBottom = options.marginBottom;
    return buttonEl;
  }

  function createActionButton(label, onClick, options = {}) {
    const buttonEl = document.createElement('button');
    buttonEl.textContent = label;
    applyButtonBaseStyle(buttonEl, options);
    if (typeof onClick === 'function') {
      buttonEl.addEventListener('click', onClick);
    }
    return buttonEl;
  }

  function createSectionShell(container, titleText, options = {}) {
    const shellEl = document.createElement('div');
    shellEl.style.border = options.border || UI_THEME.sectionBorder;
    shellEl.style.borderRadius = options.borderRadius || UI_THEME.sectionRadius;
    shellEl.style.padding = options.padding || '10px';
    shellEl.style.marginBottom = options.marginBottom || '10px';
    shellEl.style.background = options.background || UI_THEME.sectionBg;
    shellEl.style.boxShadow = options.boxShadow || 'inset 0 1px 0 rgba(255,255,255,0.02)';

    if (titleText && String(titleText).trim()) {
      const titleEl = document.createElement('div');
      titleEl.textContent = titleText;
      titleEl.style.fontWeight = '800';
      titleEl.style.fontSize = options.titleFontSize || '12px';
      titleEl.style.letterSpacing = '0.02em';
      titleEl.style.marginBottom = options.titleMarginBottom || '7px';
      titleEl.style.color = options.titleColor || UI_THEME.strongText;
      shellEl.appendChild(titleEl);
    }

    if (container) {
      container.appendChild(shellEl);
    }

    return shellEl;
  }

  function makeToggleRow(labelText, checked, onChange) {
    const row = document.createElement('label');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between';
    row.style.gap = '8px';
    row.style.marginBottom = '7px';
    row.style.cursor = 'pointer';

    const text = document.createElement('span');
    text.textContent = labelText;
    text.style.color = UI_THEME.subtleText;
    text.style.fontWeight = '600';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', onChange);

    row.appendChild(text);
    row.appendChild(input);
    return row;
  }

  function makeNumberInput(value, step = '1', min = '') {
    const input = document.createElement('input');
    input.type = 'number';
    input.value = value ?? '';
    input.step = step;
    if (min !== '') input.min = min;
    input.style.width = '72px';
    input.style.maxWidth = '72px';
    input.style.flex = '0 0 auto';
    input.style.boxSizing = 'border-box';
    input.style.background = '#111';
    input.style.color = '#fff';
    input.style.border = '1px solid rgba(255,255,255,0.14)';
    input.style.borderRadius = '6px';
    input.style.padding = '4px 6px';
    return input;
  }

  function addSectionTitle(container, text) {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.fontWeight = '800';
    el.style.fontSize = '12px';
    el.style.letterSpacing = '0.02em';
    el.style.marginBottom = '7px';
    el.style.color = UI_THEME.strongText;
    container.appendChild(el);
  }

  function getDebugSectionStateMap() {
    return getJson(STORAGE_KEYS.debugSections, {});
  }

  function isDebugSectionCollapsed(key) {
    return !!getDebugSectionStateMap()[key];
  }

  function setDebugSectionCollapsed(key, collapsed) {
    const map = getDebugSectionStateMap();
    map[key] = !!collapsed;
    setJson(STORAGE_KEYS.debugSections, map);
  }

  function toggleDebugSectionCollapsed(key) {
    setDebugSectionCollapsed(key, !isDebugSectionCollapsed(key));
    requestDebugPanelRefresh(true);
  }

  function appendDebugSection(container, key, titleText, renderContent, options = {}) {
    const showDivider = options.showDivider !== false;

    if (showDivider) {
      addDivider(container);
    }

    const sectionWrap = document.createElement('div');
    sectionWrap.style.marginBottom = '2px';

    const headerBtn = document.createElement('button');
    headerBtn.type = 'button';
    headerBtn.style.width = '100%';
    headerBtn.style.display = 'flex';
    headerBtn.style.alignItems = 'center';
    headerBtn.style.justifyContent = 'space-between';
    headerBtn.style.gap = '8px';
    headerBtn.style.background = 'transparent';
    headerBtn.style.color = '#fff';
    headerBtn.style.border = 'none';
    headerBtn.style.padding = '0';
    headerBtn.style.marginBottom = '6px';
    headerBtn.style.cursor = 'pointer';
    headerBtn.style.font = 'inherit';
    headerBtn.style.textAlign = 'left';

    const title = document.createElement('div');
    title.textContent = titleText;
    title.style.fontWeight = '700';

    const chevron = document.createElement('div');
    chevron.textContent = isDebugSectionCollapsed(key) ? '+' : '-';
    chevron.style.opacity = '0.8';
    chevron.style.fontSize = '14px';
    chevron.style.minWidth = '16px';
    chevron.style.textAlign = 'right';

    headerBtn.appendChild(title);
    headerBtn.appendChild(chevron);
    headerBtn.addEventListener('click', () => toggleDebugSectionCollapsed(key));

    sectionWrap.appendChild(headerBtn);

    if (!isDebugSectionCollapsed(key)) {
      const content = document.createElement('div');
      renderContent(content);
      sectionWrap.appendChild(content);
    }

    container.appendChild(sectionWrap);
    return sectionWrap;
  }



  function styleFormControl(controlEl, options = {}) {
    controlEl.style.background = options.background || UI_THEME.inputBg;
    controlEl.style.color = options.color || UI_THEME.strongText;
    controlEl.style.border = options.border || UI_THEME.mutedBtnBorder;
    controlEl.style.borderRadius = options.borderRadius || '8px';
    controlEl.style.padding = options.padding || '5px 7px';
    controlEl.style.fontSize = options.fontSize || '11px';
    controlEl.style.boxSizing = 'border-box';
    return controlEl;
  }

  function createLabeledControlRow(labelText) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between';
    row.style.gap = '8px';
    row.style.marginBottom = '6px';

    const label = document.createElement('span');
    label.textContent = labelText;

    row.appendChild(label);
    return { row, label };
  }

  function addDivider(container) {
    const hr = document.createElement('div');
    hr.style.borderTop = '1px solid rgba(255,255,255,0.08)';
    hr.style.margin = '10px 0';
    container.appendChild(hr);
  }

  function addDebugLine(container, label, value) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.gap = '8px';
    row.style.marginBottom = '5px';

    const left = document.createElement('span');
    left.style.color = UI_THEME.subtleText;
    left.style.fontWeight = '500';
    left.textContent = label;

    const right = document.createElement('span');
    right.style.textAlign = 'right';
    right.style.fontWeight = '700';
    right.textContent = value;

    row.appendChild(left);
    row.appendChild(right);
    container.appendChild(row);
  }

  function renderWatchItemCard(container, itemRule, index, marketValues, scanStatusMap) {
    const card = document.createElement('div');
    card.style.border = '1px solid rgba(255,255,255,0.10)';
    card.style.borderRadius = '8px';
    card.style.padding = '6px 8px';
    card.style.fontSize = '10px';
    card.style.lineHeight = '1.15';
    card.style.marginBottom = '0';
    card.style.background = 'rgba(255,255,255,0.03)';
    card.style.minWidth = '0';
    card.style.height = '100%';
    card.style.boxSizing = 'border-box';

    const top = document.createElement('div');
    top.style.display = 'flex';
    top.style.alignItems = 'center';
    top.style.justifyContent = 'space-between';
    top.style.gap = '6px';
    top.style.marginBottom = '4px';

    const name = document.createElement('div');
    name.textContent = `${itemRule.displayName} (#${itemRule.itemId})`;
    name.style.fontWeight = '700';
    name.style.fontSize = '10px';
    name.style.minWidth = '0';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = 'Remove';
    removeBtn.style.background = '#111';
    removeBtn.style.color = '#fff';
    removeBtn.style.border = '1px solid rgba(255,255,255,0.14)';
    removeBtn.style.borderRadius = '6px';
    removeBtn.style.padding = '3px 7px';
    removeBtn.style.cursor = 'pointer';
    removeBtn.addEventListener('click', () => {
      const list = getWatchlist();
      list.splice(index, 1);
      saveWatchlist(list);
    });

    top.appendChild(name);
    top.appendChild(removeBtn);
    card.appendChild(top);

    const enabledRow = makeToggleRow('Enabled', !!itemRule.enabled, () => {
      const list = getWatchlist();
      list[index].enabled = !list[index].enabled;
      saveWatchlist(list);
    });
    card.appendChild(enabledRow);

    const useMvRow = makeToggleRow('Use daily market value', !!itemRule.useMV, () => {
      const list = getWatchlist();
      list[index].useMV = !list[index].useMV;
      saveWatchlist(list);
    });
    card.appendChild(useMvRow);

    const multWrap = document.createElement('div');
    multWrap.style.display = 'flex';
    multWrap.style.alignItems = 'center';
    multWrap.style.justifyContent = 'space-between';
    multWrap.style.gap = '6px';
    multWrap.style.marginBottom = '4px';

    const multLabel = document.createElement('span');
    multLabel.textContent = 'Max price x';

    const multInput = makeNumberInput(itemRule.maxMultiplier ?? 1.10, '0.01', '0.01');
    multInput.addEventListener('change', () => {
      const list = getWatchlist();
      const n = Number(multInput.value);
      list[index].maxMultiplier = Number.isFinite(n) && n > 0 ? n : 1.10;
      saveWatchlist(list);
    });
    multInput.addEventListener('blur', () => multInput.dispatchEvent(new Event('change')));

    multWrap.appendChild(multLabel);
    multWrap.appendChild(multInput);
    card.appendChild(multWrap);

    const armorWrap = document.createElement('div');
    armorWrap.style.display = 'flex';
    armorWrap.style.alignItems = 'center';
    armorWrap.style.justifyContent = 'space-between';
    armorWrap.style.gap = '6px';
    armorWrap.style.marginBottom = '4px';

    const armorLabel = document.createElement('span');
    armorLabel.textContent = 'Min armor';

    const armorInput = makeNumberInput(itemRule.minArmor ?? '', '1', '1');
    armorInput.placeholder = 'blank = off';
    armorInput.addEventListener('change', () => {
      const list = getWatchlist();
      const raw = armorInput.value.trim();
      if (!raw) {
        list[index].minArmor = '';
      } else {
        const n = Math.max(1, Math.floor(Number(raw) || 0));
        list[index].minArmor = n > 0 ? String(n) : '';
      }
      saveWatchlist(list);
    });
    armorInput.addEventListener('blur', () => armorInput.dispatchEvent(new Event('change')));

    armorWrap.appendChild(armorLabel);
    armorWrap.appendChild(armorInput);
    card.appendChild(armorWrap);

    const qualityWrap = document.createElement('div');
    qualityWrap.style.display = 'flex';
    qualityWrap.style.alignItems = 'center';
    qualityWrap.style.justifyContent = 'space-between';
    qualityWrap.style.gap = '6px';
    qualityWrap.style.marginBottom = '4px';

    const qualityLabel = document.createElement('span');
    qualityLabel.textContent = 'Min quality';

    const qualityInput = makeNumberInput(itemRule.minQuality ?? '', '1', '1');
    qualityInput.placeholder = 'blank = off';
    qualityInput.addEventListener('change', () => {
      const list = getWatchlist();
      const raw = qualityInput.value.trim();
      if (!raw) {
        list[index].minQuality = '';
      } else {
        const n = Math.max(1, Math.floor(Number(raw) || 0));
        list[index].minQuality = n > 0 ? String(n) : '';
      }
      saveWatchlist(list);
    });
    qualityInput.addEventListener('blur', () => qualityInput.dispatchEvent(new Event('change')));

    qualityWrap.appendChild(qualityLabel);
    qualityWrap.appendChild(qualityInput);
    card.appendChild(qualityWrap);

    const pagesWrap = document.createElement('div');
    pagesWrap.style.display = 'flex';
    pagesWrap.style.alignItems = 'center';
    pagesWrap.style.justifyContent = 'space-between';
    pagesWrap.style.gap = '6px';
    pagesWrap.style.marginBottom = '4px';

    const pagesLabel = document.createElement('span');
    pagesLabel.textContent = 'Pages to scan';

    const pagesInput = makeNumberInput(itemRule.pagesToScan ?? 1, '1', '1');
    pagesInput.placeholder = '1';
    pagesInput.addEventListener('change', () => {
      const list = getWatchlist();
      const raw = pagesInput.value.trim();
      const n = Math.min(5, Math.max(1, Math.floor(Number(raw) || 1)));
      list[index].pagesToScan = n;
      saveWatchlist(list);
    });
    pagesInput.addEventListener('blur', () => pagesInput.dispatchEvent(new Event('change')));

    pagesWrap.appendChild(pagesLabel);
    pagesWrap.appendChild(pagesInput);
    card.appendChild(pagesWrap);

    const mv = marketValues[itemRule.itemId];
    if (typeof mv !== 'undefined') {
      const mvLine = document.createElement('div');
      mvLine.style.fontSize = '10px';
      mvLine.style.opacity = '0.75';
      mvLine.textContent = `Daily MV: $${Number(mv).toLocaleString()}`;
      card.appendChild(mvLine);
    }

    const scanStatus = scanStatusMap?.[itemRule.itemId];
    const statusWrap = document.createElement('div');
    statusWrap.style.marginTop = '4px';
    statusWrap.style.paddingTop = '4px';
    statusWrap.style.borderTop = '1px solid rgba(255,255,255,0.08)';
    statusWrap.style.fontSize = '10px';
    statusWrap.style.opacity = '0.88';

    const stateText = !scanStatus ? 'Not scanned yet'
      : scanStatus.ok ? 'Scan OK'
      : 'Scan failed';

    const stateLine = document.createElement('div');
    stateLine.textContent = `Status: ${stateText}`;
    stateLine.style.color = scanStatus ? (scanStatus.ok ? '#9fe3a3' : '#ff9b9b') : '#d0d0d0';
    statusWrap.appendChild(stateLine);

    if (scanStatus) {
      const checkedLine = document.createElement('div');
      checkedLine.textContent = `Checked: ${formatElapsedSince(scanStatus.at)}`;
      statusWrap.appendChild(checkedLine);

      if (Number.isFinite(scanStatus.pagesScanned)) {
        const pagesLine = document.createElement('div');
        pagesLine.textContent = `Pages: ${scanStatus.pagesScanned}/${scanStatus.pagesRequested || scanStatus.pagesScanned}`;
        statusWrap.appendChild(pagesLine);
      }

      if (Array.isArray(scanStatus.pageDetails) && scanStatus.pageDetails.length) {
        const pagingLine = document.createElement('div');
        const duplicatePageData = !!scanStatus.duplicatePageData;
        pagingLine.textContent = `Paging: ${duplicatePageData ? 'duplicate page data detected' : 'OK'} (${scanStatus.uniquePageSignatures || scanStatus.pageDetails.length} unique)`;
        pagingLine.style.color = duplicatePageData ? '#ffd37a' : '#9fe3a3';
        statusWrap.appendChild(pagingLine);

        scanStatus.pageDetails.slice(0, 5).forEach(detail => {
          const detailLine = document.createElement('div');
          const shortSig = String(detail?.signature || 'empty');
          detailLine.textContent = `P${detail.page}: ${detail.count} listings | ${shortSig.length > 54 ? `${shortSig.slice(0, 54)}...` : shortSig}`;
          detailLine.style.opacity = '0.82';
          statusWrap.appendChild(detailLine);
        });
      }

      if (Number.isFinite(scanStatus.listingsScanned)) {
        const listingsLine = document.createElement('div');
        listingsLine.textContent = `Listings scanned: ${scanStatus.listingsScanned}`;
        statusWrap.appendChild(listingsLine);
      }

      if (scanStatus.matchFound) {
        const matchLine = document.createElement('div');
        matchLine.textContent = `Result: match found`;
        statusWrap.appendChild(matchLine);
      } else if (scanStatus.ok) {
        const matchLine = document.createElement('div');
        matchLine.textContent = `Result: no match in scanned pages`;
        statusWrap.appendChild(matchLine);
      }

      if (scanStatus.errorMessage) {
        const errLine = document.createElement('div');
        errLine.textContent = `Error: ${scanStatus.errorMessage}`;
        errLine.style.color = '#ff9b9b';
        statusWrap.appendChild(errLine);
      }
    }

    card.appendChild(statusWrap);
    container.appendChild(card);
  }


  function estimateApiUsagePerMinute() {
    const settings = getSettings();
    const watchlist = getWatchlist().filter(item => item && item.enabled);

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


  function buildDebugPanelViewModel() {
    const settings = getSettings();
    const watchlist = getWatchlist();
    const popupHistory = prunePopupHistory(loadPopupHistory());
    savePopupHistory(popupHistory);

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
      membership: { ...membershipState },
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

  function renderDebugPanelMinimized(viewModel) {
    debugPanelEl.innerHTML = '';

    const topBar = document.createElement('div');
    topBar.style.display = 'flex';
    topBar.style.alignItems = 'center';
    topBar.style.justifyContent = 'space-between';
    topBar.style.gap = '8px';
    topBar.style.position = 'sticky';
    topBar.style.top = '0';
    topBar.style.zIndex = '3';
    topBar.style.background = 'rgba(10,10,10,0.98)';
    topBar.style.paddingBottom = '6px';

    const title = document.createElement('div');
    title.textContent = `Watcher Debug | v${viewModel.version}`;
    title.style.fontWeight = '700';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '[ ]';
    btn.style.background = '#111';
    btn.style.color = '#fff';
    btn.style.border = '1px solid rgba(255,255,255,0.16)';
    btn.style.borderRadius = '6px';
    btn.style.padding = '2px 8px';
    btn.style.cursor = 'pointer';
    btn.addEventListener('click', () => {
      setDebugPanelMinimized(false);
      requestDebugPanelRefresh(true);
    });

    topBar.appendChild(title);
    topBar.appendChild(btn);
    debugPanelEl.appendChild(topBar);

    const info = document.createElement('div');
    info.style.marginTop = '8px';
    info.style.opacity = '0.8';
    info.textContent = 'Panel minimized';
    debugPanelEl.appendChild(info);
  }

  function refreshDebugPanel(force = false) {
    if (!isDebugVisible()) return;
    ensureDebugPanel();

    if (!force && uiState.searchFocused) {
      return;
    }

    const viewModel = buildDebugPanelViewModel();

    if (viewModel.isMinimized) {
      renderDebugPanelMinimized(viewModel);
      return;
    }

    const {
      settings,
      watchlist,
      lastAlert,
      lastError,
      lastScanAt,
      lastValueFetch,
      marketValues,
      scanStatusMap,
      popupHistory,
      membership,
      apiEstimate
    } = viewModel;

    debugPanelEl.innerHTML = '';

    const topBar = document.createElement('div');
    topBar.style.display = 'flex';
    topBar.style.alignItems = 'center';
    topBar.style.justifyContent = 'space-between';
    topBar.style.gap = '8px';
    topBar.style.marginBottom = '8px';
    topBar.style.paddingRight = '4px';
    topBar.style.position = 'sticky';
    topBar.style.top = '0';
    topBar.style.zIndex = '3';
    topBar.style.background = 'rgba(10,10,10,0.98)';
    topBar.style.paddingBottom = '6px';

    const title = document.createElement('div');
    title.textContent = `Watcher Debug | v${viewModel.version}`;
    title.style.fontWeight = '700';

    const topBtns = document.createElement('div');
    topBtns.style.display = 'flex';
    topBtns.style.gap = '6px';

    const minimizeBtn = document.createElement('button');
    minimizeBtn.type = 'button';
    minimizeBtn.textContent = '_';
    minimizeBtn.style.background = '#111';
    minimizeBtn.style.color = '#fff';
    minimizeBtn.style.border = '1px solid rgba(255,255,255,0.16)';
    minimizeBtn.style.borderRadius = '6px';
    minimizeBtn.style.padding = '2px 8px';
    minimizeBtn.style.cursor = 'pointer';
    minimizeBtn.addEventListener('click', () => {
      setDebugPanelMinimized(true);
      requestDebugPanelRefresh(true);
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'X';
    closeBtn.style.background = '#111';
    closeBtn.style.color = '#fff';
    closeBtn.style.border = '1px solid rgba(255,255,255,0.16)';
    closeBtn.style.borderRadius = '6px';
    closeBtn.style.padding = '2px 8px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.addEventListener('click', () => {
      setDebugVisible(false);
      rebuildDebugPanel();
    });

    topBtns.appendChild(minimizeBtn);
    topBtns.appendChild(closeBtn);
    topBar.appendChild(title);
    topBar.appendChild(topBtns);
    debugPanelEl.appendChild(topBar);
    enableDebugPanelDrag(topBar);

    const statusBlock = document.createElement('div');
    addDebugLine(statusBlock, 'Enabled', viewModel.isEnabled ? 'yes' : 'no');
    addDebugLine(statusBlock, 'Leader', viewModel.isLeader ? 'yes' : 'no');
    addDebugLine(statusBlock, 'Running loop', viewModel.isRunningLoop ? 'yes' : 'no');
    addDebugLine(statusBlock, 'Last scan', fmtTime(lastScanAt));
    addDebugLine(statusBlock, 'Last values', fmtTime(lastValueFetch));
    addDebugLine(statusBlock, 'Poll', `${Math.floor(settings.pollMs / 1000)}s`);
    addDebugLine(statusBlock, 'Cooldown', `${Math.floor(settings.alertCooldownMs / 1000)}s`);
    addDebugLine(statusBlock, 'Enabled items', String(apiEstimate.enabledItems));
    addDebugLine(statusBlock, 'Req / cycle', String(apiEstimate.requestsPerCycle));
    addDebugLine(statusBlock, 'Est. API / min', apiEstimate.requestsPerMinute.toFixed(1));
    debugPanelEl.appendChild(statusBlock);

    appendDebugSection(debugPanelEl, 'membership', 'Membership', (section) => {
      const membershipInfo = document.createElement('div');
      membershipInfo.style.marginBottom = '8px';
      membershipInfo.style.opacity = '0.9';
      membershipInfo.textContent = membership.checked
        ? `Status: ${membership.active ? 'Active' : 'Inactive'} | Player: ${membership.playerName || 'Unknown'} (${membership.playerId || 'n/a'})`
        : 'Status: not checked yet';
      section.appendChild(membershipInfo);

      if (!membership.active) {
        const inactiveMembershipBox = document.createElement('div');
        inactiveMembershipBox.style.padding = '8px';
        inactiveMembershipBox.style.background = 'rgba(120,90,18,0.25)';
        inactiveMembershipBox.style.border = '1px solid rgba(255,255,255,0.15)';
        inactiveMembershipBox.style.borderRadius = '6px';
        inactiveMembershipBox.style.marginBottom = '8px';
        inactiveMembershipBox.style.fontSize = '11px';
        inactiveMembershipBox.style.lineHeight = '1.4';
        inactiveMembershipBox.innerHTML =
          '<b>Membership inactive</b><br>' +
          'Send 1 Xanax to Leviathan [3634894]<br>' +
          'to receive 5 days access.<br><br>' +
          'Initial signup includes a 1 day trial.';
        section.appendChild(inactiveMembershipBox);
      }

      const membershipInput = document.createElement('input');
      membershipInput.type = 'text';
      membershipInput.placeholder = 'Paste Torn API key here';
      membershipInput.value = '';
      membershipInput.style.width = '100%';
      membershipInput.style.boxSizing = 'border-box';
      membershipInput.style.background = '#111';
      membershipInput.style.color = '#fff';
      membershipInput.style.border = '1px solid rgba(255,255,255,0.14)';
      membershipInput.style.borderRadius = '6px';
      membershipInput.style.padding = '6px 8px';
      membershipInput.style.marginBottom = '8px';
      section.appendChild(membershipInput);

      const membershipKeyHint = document.createElement('div');
      membershipKeyHint.style.fontSize = '10px';
      membershipKeyHint.style.opacity = '0.75';
      membershipKeyHint.style.marginBottom = '8px';
      membershipKeyHint.textContent = 'Recommended: use a LIMITED Torn API key. Full access is not needed for market scanning.';
      section.appendChild(membershipKeyHint);

      const membershipBtnRow = document.createElement('div');
      membershipBtnRow.style.display = 'flex';
      membershipBtnRow.style.gap = '6px';
      membershipBtnRow.style.marginBottom = '8px';
      membershipBtnRow.style.flexWrap = 'wrap';

      const registerBtn = document.createElement('button');
      registerBtn.type = 'button';
      registerBtn.textContent = 'Save API + Register';
      registerBtn.style.background = '#111';
      registerBtn.style.color = '#fff';
      registerBtn.style.border = '1px solid rgba(255,255,255,0.14)';
      registerBtn.style.borderRadius = '6px';
      registerBtn.style.padding = '4px 8px';
      registerBtn.style.cursor = 'pointer';
      registerBtn.addEventListener('click', async () => {
        const apiKey = String(membershipInput.value || '').trim();
        if (!apiKey) {
          alert('Paste your Torn API key into the box first.');
          return;
        }

        try {
          const keyType = await detectApiKeyType(apiKey);

          if (keyType === 'full') {
            const proceed = window.confirm(
              'Warning: you are using a FULL ACCESS Torn API key.\n\n' +
              'This script only needs a LIMITED key for market scanning.\n\n' +
              'Using a full key is not recommended. Continue anyway?'
            );

            if (!proceed) return;
          }

          const reg = await registerWithServer(apiKey);
          const status = await checkAuthStatus(reg.playerId);
          applyMembershipState(status);
          membershipInput.value = '';
          alert(`Registered as ${reg.playerName} (${reg.playerId}). Stored API key will now be used for market scanning too.`);
        } catch (err) {
          alert(`Registration failed: ${err?.message || err}`);
        }
      });

      const refreshMembershipBtn = document.createElement('button');
      refreshMembershipBtn.type = 'button';
      refreshMembershipBtn.textContent = 'Refresh Membership';
      refreshMembershipBtn.style.background = '#111';
      refreshMembershipBtn.style.color = '#fff';
      refreshMembershipBtn.style.border = '1px solid rgba(255,255,255,0.14)';
      refreshMembershipBtn.style.borderRadius = '6px';
      refreshMembershipBtn.style.padding = '4px 8px';
      refreshMembershipBtn.style.cursor = 'pointer';
      refreshMembershipBtn.addEventListener('click', async () => {
        const playerId = getStoredPlayerId();
        if (!playerId) {
          alert('No registered player ID stored yet.');
          return;
        }

        try {
          const status = await checkAuthStatus(playerId);
          applyMembershipState(status);
          alert(`Membership is now ${status.active ? 'active' : 'inactive'}.`);
        } catch (err) {
          alert(`Refresh failed: ${err?.message || err}`);
        }
      });

      const clearMembershipBtn = document.createElement('button');
      clearMembershipBtn.type = 'button';
      clearMembershipBtn.textContent = 'Clear Stored API';
      clearMembershipBtn.style.background = '#111';
      clearMembershipBtn.style.color = '#fff';
      clearMembershipBtn.style.border = '1px solid rgba(255,255,255,0.14)';
      clearMembershipBtn.style.borderRadius = '6px';
      clearMembershipBtn.style.padding = '4px 8px';
      clearMembershipBtn.style.cursor = 'pointer';
      clearMembershipBtn.addEventListener('click', () => {
        const confirmed = window.confirm('Clear the stored API key, player ID, player name, and membership cache on this browser?');
        if (!confirmed) return;
        clearStoredMembership();
        membershipInput.value = '';
        alert('Stored API and membership data cleared.');
      });

      membershipBtnRow.appendChild(registerBtn);
      membershipBtnRow.appendChild(refreshMembershipBtn);
      membershipBtnRow.appendChild(clearMembershipBtn);
      section.appendChild(membershipBtnRow);

      if (membershipState.expiresAt) {
        const expiryInfo = document.createElement('div');
        expiryInfo.style.marginBottom = '8px';
        expiryInfo.style.opacity = '0.8';
        expiryInfo.textContent = `Expires: ${formatDateTime(membershipState.expiresAt)} | Time left: ${formatMembershipRemaining(membershipState.msLeft)}`;
        section.appendChild(expiryInfo);
      }

      if (membershipState.reason) {
        const reasonInfo = document.createElement('div');
        reasonInfo.style.marginBottom = '8px';
        reasonInfo.style.opacity = '0.75';
        reasonInfo.textContent = `Reason: ${membershipState.reason}`;
        section.appendChild(reasonInfo);
      }

      const storedApiKeyInfo = document.createElement('div');
      storedApiKeyInfo.style.marginBottom = '8px';
      storedApiKeyInfo.style.opacity = '0.75';
      storedApiKeyInfo.textContent = `Stored scan API: ${getEffectiveApiKey() ? 'present' : 'missing'}`;
      section.appendChild(storedApiKeyInfo);

      const membershipTrialInfo = document.createElement('div');
      membershipTrialInfo.style.fontSize = '10px';
      membershipTrialInfo.style.opacity = '0.85';
      membershipTrialInfo.style.marginBottom = '4px';
      membershipTrialInfo.textContent = MEMBERSHIP_TRIAL_MESSAGE;
      section.appendChild(membershipTrialInfo);

      const membershipPaymentInfo = document.createElement('div');
      membershipPaymentInfo.style.fontSize = '10px';
      membershipPaymentInfo.style.opacity = '0.85';
      membershipPaymentInfo.style.marginBottom = '8px';
      membershipPaymentInfo.textContent = MEMBERSHIP_PAYMENT_MESSAGE;
      section.appendChild(membershipPaymentInfo);
    });

    appendDebugSection(debugPanelEl, 'global_settings', 'Global settings', (section) => {
      section.appendChild(
        makeToggleRow('Watcher enabled', isEnabled(), () => {
          unlockAudioContext();
          setWatcherEnabledState(!isEnabled());
        })
      );

      const resizeHint = document.createElement('div');
      resizeHint.style.fontSize = '10px';
      resizeHint.style.opacity = '0.75';
      resizeHint.style.marginBottom = '8px';
      resizeHint.textContent = 'Tip: drag the bottom-right corner of this panel to resize it.';
      section.appendChild(resizeHint);

      const apiEstimateNote = document.createElement('div');
      apiEstimateNote.style.fontSize = '10px';
      apiEstimateNote.style.opacity = '0.75';
      apiEstimateNote.style.marginBottom = '8px';
      apiEstimateNote.textContent = 'Estimate is based on enabled items, pages per item, and global poll rate.';
      section.appendChild(apiEstimateNote);

      const pollRow = document.createElement('div');
      pollRow.style.display = 'flex';
      pollRow.style.alignItems = 'center';
      pollRow.style.justifyContent = 'space-between';
      pollRow.style.gap = '8px';
      pollRow.style.marginBottom = '6px';

      const pollLabel = document.createElement('span');
      pollLabel.textContent = 'Poll ms';
      const pollInput = makeNumberInput(settings.pollMs, '1000', '5000');
      pollInput.addEventListener('change', () => {
        const n = Math.max(5000, Math.floor(Number(pollInput.value) || DEFAULTS.pollMs));
        const next = getSettings();
        next.pollMs = n;
        saveSettings(next);
      });
      pollInput.addEventListener('blur', () => pollInput.dispatchEvent(new Event('change')));
      pollRow.appendChild(pollLabel);
      pollRow.appendChild(pollInput);
      section.appendChild(pollRow);

      const cdRow = document.createElement('div');
      cdRow.style.display = 'flex';
      cdRow.style.alignItems = 'center';
      cdRow.style.justifyContent = 'space-between';
      cdRow.style.gap = '8px';
      cdRow.style.marginBottom = '6px';

      const cdLabel = document.createElement('span');
      cdLabel.textContent = 'Cooldown ms';
      const cdInput = makeNumberInput(settings.alertCooldownMs, '1000', '0');
      cdInput.addEventListener('change', () => {
        const n = Math.max(0, Math.floor(Number(cdInput.value) || DEFAULTS.alertCooldownMs));
        const next = getSettings();
        next.alertCooldownMs = n;
        saveSettings(next);
      });
      cdInput.addEventListener('blur', () => cdInput.dispatchEvent(new Event('change')));
      cdRow.appendChild(cdLabel);
      cdRow.appendChild(cdInput);
      section.appendChild(cdRow);

      section.appendChild(
        makeToggleRow('Vibration', settings.vibrationEnabled, () => {
          const next = getSettings();
          next.vibrationEnabled = !next.vibrationEnabled;
          saveSettings(next);
        })
      );

      section.appendChild(
        makeToggleRow('Sound', settings.soundEnabled, () => {
          unlockAudioContext();
          const next = getSettings();
          next.soundEnabled = !next.soundEnabled;
          saveSettings(next);
        })
      );

      section.appendChild(
        makeToggleRow('Desktop notifications', settings.desktopNotificationsEnabled, () => {
          const next = getSettings();
          next.desktopNotificationsEnabled = !next.desktopNotificationsEnabled;
          saveSettings(next);
        })
      );

      const soundVolumeRow = document.createElement('div');
      soundVolumeRow.style.display = 'flex';
      soundVolumeRow.style.alignItems = 'center';
      soundVolumeRow.style.justifyContent = 'space-between';
      soundVolumeRow.style.gap = '8px';
      soundVolumeRow.style.marginBottom = '6px';

      const soundVolumeLabel = document.createElement('span');
      soundVolumeLabel.textContent = `Sound volume (${settings.soundVolume}%)`;

      const soundVolumeInput = document.createElement('input');
      soundVolumeInput.type = 'range';
      soundVolumeInput.min = '0';
      soundVolumeInput.max = '300';
      soundVolumeInput.step = '5';
      soundVolumeInput.value = String(settings.soundVolume);
      soundVolumeInput.style.width = '140px';

      soundVolumeInput.addEventListener('input', () => {
        soundVolumeLabel.textContent = `Sound volume (${soundVolumeInput.value}%)`;
      });

      soundVolumeInput.addEventListener('change', () => {
        const next = getSettings();
        next.soundVolume = Math.max(0, Math.min(300, Number(soundVolumeInput.value) || DEFAULTS.soundVolume));
        saveSettings(next);
      });

      soundVolumeRow.appendChild(soundVolumeLabel);
      soundVolumeRow.appendChild(soundVolumeInput);
      section.appendChild(soundVolumeRow);

      const soundPresetRow = document.createElement('div');
      soundPresetRow.style.display = 'flex';
      soundPresetRow.style.alignItems = 'center';
      soundPresetRow.style.justifyContent = 'space-between';
      soundPresetRow.style.gap = '8px';
      soundPresetRow.style.marginBottom = '6px';

      const soundPresetLabel = document.createElement('span');
      soundPresetLabel.textContent = 'Sound preset';

      const soundPresetSelect = document.createElement('select');
      soundPresetSelect.style.background = UI_THEME.inputBg;
      soundPresetSelect.style.color = '#fff';
      soundPresetSelect.style.border = UI_THEME.mutedBtnBorder;
      soundPresetSelect.style.borderRadius = '8px';
      soundPresetSelect.style.padding = '4px 6px';

      [
        ['classic', 'Classic'],
        ['arcade', 'Arcade'],
        ['alarm', 'Alarm']
      ].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        if (settings.soundPreset === value) option.selected = true;
        soundPresetSelect.appendChild(option);
      });

      soundPresetSelect.addEventListener('change', () => {
        const next = getSettings();
        next.soundPreset = soundPresetSelect.value;
        saveSettings(next);
      });

      soundPresetRow.appendChild(soundPresetLabel);
      soundPresetRow.appendChild(soundPresetSelect);
      section.appendChild(soundPresetRow);

      const soundTestRow = document.createElement('div');
      soundTestRow.style.display = 'flex';
      soundTestRow.style.justifyContent = 'flex-end';
      soundTestRow.style.marginBottom = '8px';

      const soundTestBtn = document.createElement('button');
      soundTestBtn.type = 'button';
      soundTestBtn.textContent = 'Test sound';
      soundTestBtn.style.background = '#111';
      soundTestBtn.style.color = '#fff';
      soundTestBtn.style.border = '1px solid rgba(255,255,255,0.14)';
      soundTestBtn.style.borderRadius = '6px';
      soundTestBtn.style.padding = '4px 8px';
      soundTestBtn.style.cursor = 'pointer';

      soundTestBtn.addEventListener('click', () => {
        unlockAudioContext();
        soundForTier('insane');

        const oldText = soundTestBtn.textContent;
        soundTestBtn.textContent = 'Played';
        setTimeout(() => {
          soundTestBtn.textContent = oldText;
        }, 800);
      });

      soundTestRow.appendChild(soundTestBtn);
      section.appendChild(soundTestRow);

      const notifRow = document.createElement('div');
      notifRow.style.display = 'flex';
      notifRow.style.justifyContent = 'space-between';
      notifRow.style.alignItems = 'center';
      notifRow.style.gap = '8px';
      notifRow.style.marginBottom = '8px';

      const notifLabel = document.createElement('span');
      const notifBtn = document.createElement('button');
      notifBtn.type = 'button';
      notifBtn.style.background = '#111';
      notifBtn.style.color = '#fff';
      notifBtn.style.border = '1px solid rgba(255,255,255,0.14)';
      notifBtn.style.borderRadius = '6px';
      notifBtn.style.padding = '4px 8px';
      notifBtn.style.cursor = 'pointer';

      syncDesktopNotificationControls(notifLabel, notifBtn);

      notifBtn.addEventListener('click', async () => {
        await handleDesktopNotificationButtonClick(notifLabel, notifBtn);
      });

      notifRow.appendChild(notifLabel);
      notifRow.appendChild(notifBtn);
      section.appendChild(notifRow);
    });

    appendDebugSection(debugPanelEl, 'add_item', 'Add item', (section) => {
      const addWrap = document.createElement('div');
      addWrap.style.marginBottom = '8px';

      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.placeholder = 'Start typing item name...';
      searchInput.value = uiState.searchQuery;
      searchInput.style.width = '100%';
      searchInput.style.boxSizing = 'border-box';
      searchInput.style.background = '#111';
      searchInput.style.color = '#fff';
      searchInput.style.border = '1px solid rgba(255,255,255,0.14)';
      searchInput.style.borderRadius = '6px';
      searchInput.style.padding = '6px 8px';

      const resultsWrap = document.createElement('div');
      resultsWrap.style.marginTop = '6px';
      resultsWrap.style.maxHeight = '150px';
      resultsWrap.style.overflowY = 'auto';

      function renderSearchResults() {
        resultsWrap.innerHTML = '';

        const existingIds = new Set(getWatchlist().map(x => x.itemId));
        const results = searchCatalog(uiState.searchQuery, existingIds);

        if (!uiState.searchQuery.trim()) return;

        if (results.length === 0) {
          const none = document.createElement('div');
          none.textContent = 'No matches';
          none.style.opacity = '0.7';
          none.style.padding = '6px 8px';
          resultsWrap.appendChild(none);
          return;
        }

        results.forEach(item => {
          const row = document.createElement('div');
          row.textContent = `${item.displayName} (#${item.itemId})`;
          row.style.padding = '6px 8px';
          row.style.border = '1px solid rgba(255,255,255,0.08)';
          row.style.borderRadius = '6px';
          row.style.marginBottom = '4px';
          row.style.cursor = 'pointer';
          row.style.background = 'rgba(255,255,255,0.03)';

          row.addEventListener('click', () => {
            const list = getWatchlist();
            list.push({
              id: `watch_${item.itemId}_${Date.now()}`,
              itemId: item.itemId,
              rawName: item.rawName,
              displayName: item.displayName,
              enabled: true,
              useMV: true,
              maxMultiplier: 1.10,
              minArmor: '',
              minQuality: '',
              pagesToScan: 1
            });
            saveWatchlist(list);

            uiState.searchQuery = '';
            uiState.searchFocused = false;
            searchInput.value = '';
            renderSearchResults();
            requestDebugPanelRefresh(true);
          });

          resultsWrap.appendChild(row);
        });
      }

      searchInput.addEventListener('focus', () => {
        uiState.searchFocused = true;
      });

      searchInput.addEventListener('blur', () => {
        setTimeout(() => {
          uiState.searchFocused = false;
        }, 150);
      });

      searchInput.addEventListener('input', () => {
        uiState.searchQuery = searchInput.value;
        renderSearchResults();
      });

      renderSearchResults();

      addWrap.appendChild(searchInput);
      addWrap.appendChild(resultsWrap);
      section.appendChild(addWrap);
    });

    appendDebugSection(debugPanelEl, 'watchlist', 'Watchlist', (section) => {
      const filterActions = document.createElement('div');
      filterActions.style.display = 'flex';
      filterActions.style.flexWrap = 'wrap';
      filterActions.style.gap = '6px';
      filterActions.style.marginBottom = '8px';

      const exportFiltersBtn = document.createElement('button');
      exportFiltersBtn.type = 'button';
      exportFiltersBtn.textContent = 'Export filters';
      exportFiltersBtn.style.background = '#111';
      exportFiltersBtn.style.color = '#fff';
      exportFiltersBtn.style.border = '1px solid rgba(255,255,255,0.14)';
      exportFiltersBtn.style.borderRadius = '6px';
      exportFiltersBtn.style.padding = '4px 8px';
      exportFiltersBtn.style.cursor = 'pointer';
      exportFiltersBtn.addEventListener('click', async () => {
        try {
          await exportWatchlistFilters();
        } catch (err) {
          alert(`Export failed: ${err?.message || err}`);
        }
      });

      const importFiltersBtn = document.createElement('button');
      importFiltersBtn.type = 'button';
      importFiltersBtn.textContent = 'Import filters';
      importFiltersBtn.style.background = '#111';
      importFiltersBtn.style.color = '#fff';
      importFiltersBtn.style.border = '1px solid rgba(255,255,255,0.14)';
      importFiltersBtn.style.borderRadius = '6px';
      importFiltersBtn.style.padding = '4px 8px';
      importFiltersBtn.style.cursor = 'pointer';
      importFiltersBtn.addEventListener('click', async () => {
        try {
          await promptImportWatchlistFilters();
        } catch (err) {
          alert(`Import failed: ${err?.message || err}`);
        }
      });

      filterActions.appendChild(exportFiltersBtn);
      filterActions.appendChild(importFiltersBtn);
      section.appendChild(filterActions);

      const filterHint = document.createElement('div');
      filterHint.style.fontSize = '10px';
      filterHint.style.opacity = '0.72';
      filterHint.style.marginBottom = '8px';
      filterHint.textContent = 'Export saves your watchlist filters as JSON. Import can replace or merge them on another device.';
      section.appendChild(filterHint);

      if (watchlist.length === 0) {
        const none = document.createElement('div');
        none.style.opacity = '0.7';
        none.textContent = 'No watched items yet.';
        section.appendChild(none);
      } else {
        const watchlistGrid = document.createElement('div');
        watchlistGrid.style.display = 'grid';
        watchlistGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(280px, 1fr))';
        watchlistGrid.style.gap = '6px';
        watchlistGrid.style.alignItems = 'start';
        watchlistGrid.style.width = '100%';
        watchlistGrid.style.boxSizing = 'border-box';

        watchlist.forEach((itemRule, index) => {
          renderWatchItemCard(watchlistGrid, itemRule, index, marketValues, scanStatusMap);
        });

        section.appendChild(watchlistGrid);
      }
    });

    appendDebugSection(debugPanelEl, 'diagnostics', 'Diagnostics', (section) => {
      const lastAlertBox = document.createElement('div');
      lastAlertBox.style.marginBottom = '6px';
      lastAlertBox.style.opacity = '0.85';
      lastAlertBox.textContent = `Last alert: ${lastAlert.message} @ ${formatDateTime(lastAlert.at)}`;
      section.appendChild(lastAlertBox);

      const lastErrorBox = document.createElement('div');
      lastErrorBox.style.opacity = '0.85';
      lastErrorBox.textContent = `Last error: ${lastError.message} @ ${formatDateTime(lastError.at)}`;
      section.appendChild(lastErrorBox);
    });

    appendDebugSection(debugPanelEl, 'popup_history', `Popup history (last 3h, ${popupHistory.length})`, (section) => {
      const historyControls = document.createElement('div');
      historyControls.style.display = 'flex';
      historyControls.style.justifyContent = 'flex-end';
      historyControls.style.marginBottom = '6px';

      const clearHistoryBtn = document.createElement('button');
      clearHistoryBtn.type = 'button';
      clearHistoryBtn.textContent = 'Clear history';
      clearHistoryBtn.style.background = '#111';
      clearHistoryBtn.style.color = '#fff';
      clearHistoryBtn.style.border = '1px solid rgba(255,255,255,0.14)';
      clearHistoryBtn.style.borderRadius = '6px';
      clearHistoryBtn.style.padding = '4px 8px';
      clearHistoryBtn.style.cursor = 'pointer';
      clearHistoryBtn.addEventListener('click', () => clearPopupHistory());
      historyControls.appendChild(clearHistoryBtn);
      section.appendChild(historyControls);

      if (popupHistory.length === 0) {
        const none = document.createElement('div');
        none.style.opacity = '0.7';
        none.textContent = 'No popup hits in the last 3 hours.';
        section.appendChild(none);
      } else {
        const historyWrap = document.createElement('div');
        historyWrap.style.display = 'flex';
        historyWrap.style.flexDirection = 'column';
        historyWrap.style.gap = '6px';

        popupHistory.forEach(entry => {
          const card = document.createElement('div');
          card.style.border = '1px solid rgba(255,255,255,0.10)';
          card.style.borderRadius = '10px';
          card.style.padding = '8px';
          card.style.background = 'rgba(255,255,255,0.03)';

          const top = document.createElement('div');
          top.style.display = 'flex';
          top.style.justifyContent = 'space-between';
          top.style.gap = '8px';
          top.style.marginBottom = '4px';

          const left = document.createElement('div');
          left.style.fontWeight = '700';
          left.textContent = entry.itemName || `Item #${entry.itemId}`;

          const right = document.createElement('div');
          right.style.opacity = '0.72';
          right.style.fontSize = '10px';
          right.textContent = formatElapsedSince(entry.at);

          top.appendChild(left);
          top.appendChild(right);
          card.appendChild(top);

          const body = document.createElement('div');
          body.style.fontSize = '10px';
          body.style.lineHeight = '1.3';
          body.style.wordBreak = 'break-word';
          body.textContent = entry.text || '';
          card.appendChild(body);

          const footer = document.createElement('div');
          footer.style.display = 'flex';
          footer.style.justifyContent = 'space-between';
          footer.style.alignItems = 'center';
          footer.style.gap = '8px';
          footer.style.marginTop = '6px';

          const meta = document.createElement('div');
          meta.style.opacity = '0.7';
          meta.style.fontSize = '10px';
          meta.textContent = `${formatDateTime(entry.at)}${Number(entry.count || 1) > 1 ? `  *  x${Number(entry.count || 1)}` : ''}`;
          footer.appendChild(meta);

          if (entry.url) {
            const openBtn = document.createElement('button');
            openBtn.type = 'button';
            openBtn.textContent = 'Open';
            openBtn.style.background = '#111';
            openBtn.style.color = '#fff';
            openBtn.style.border = '1px solid rgba(255,255,255,0.14)';
            openBtn.style.borderRadius = '6px';
            openBtn.style.padding = '4px 8px';
            openBtn.style.cursor = 'pointer';
            openBtn.addEventListener('click', () => { location.href = entry.url; });
            footer.appendChild(openBtn);
          }

          card.appendChild(footer);
          historyWrap.appendChild(card);
        });

        section.appendChild(historyWrap);
      }
    });
  }

  function apiFetch(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        onload: (res) => {
          try {
            if (res.status < 200 || res.status >= 300) {
              reject(new Error(`HTTP ${res.status}`));
              return;
            }

            const data = JSON.parse(res.responseText);
            if (data?.error) {
              reject(new Error(data.error.error || JSON.stringify(data.error)));
              return;
            }

            resolve(data);
          } catch (err) {
            reject(err);
          }
        },
        onerror: () => reject(new Error('GM_xmlhttpRequest failed'))
      });
    });
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
    return apiFetch(`https://api.torn.com/v2/market/${itemId}/itemmarket?offset=${offset}&key=${encodeURIComponent(apiKey)}`);
  }

  function extractListings(data) {
    if (Array.isArray(data?.itemmarket?.listings)) return data.itemmarket.listings;
    if (data?.itemmarket?.listings && typeof data.itemmarket.listings === 'object') {
      return Object.values(data.itemmarket.listings);
    }

    if (Array.isArray(data?.listings)) return data.listings;
    if (data?.listings && typeof data.listings === 'object') {
      return Object.values(data.listings);
    }

    if (Array.isArray(data?.itemmarket)) return data.itemmarket;
    if (data?.itemmarket && typeof data.itemmarket === 'object') {
      return Object.values(data.itemmarket);
    }

    return [];
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
    const direct = Number(
      listing?.armor ??
      listing?.item?.armor ??
      listing?.item_details?.armor ??
      listing?.itemDetails?.armor ??
      NaN
    );

    if (Number.isFinite(direct) && direct > 0) {
      return direct;
    }

    const deep = deepFindNumericField(listing, 'armor');
    if (Number.isFinite(deep) && deep > 0) {
      return deep;
    }

    return null;
  }

  function extractArmor(listing) {
    const raw = extractArmorRaw(listing);
    return Number.isFinite(raw) ? Math.floor(raw) : null;
  }

  function extractQualityRaw(listing) {
    const direct = Number(
      listing?.quality ??
      listing?.item?.quality ??
      listing?.item_details?.quality ??
      listing?.itemDetails?.quality ??
      NaN
    );

    if (Number.isFinite(direct) && direct > 0) {
      return direct;
    }

    const deep = deepFindNumericField(listing, 'quality');
    if (Number.isFinite(deep) && deep > 0) {
      return deep;
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

    const likelySellComp = comps.find(comp => comp.price >= buyPrice * STEAL_COMP_MAX_MULTIPLIER) || null;
    const anchorComp = likelySellComp || (ALLOW_FALLBACK_COMP_ESTIMATE ? comps[0] : null);

    if (!anchorComp) {
      return null;
    }

    const sellPrice = Math.max(buyPrice, anchorComp.price - COMP_UNDERCUT);
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
      usedFallback: !likelySellComp
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

    for (const item of ITEM_CATALOG) {
      const apiItem = data?.items?.[item.itemId];
      if (apiItem && typeof apiItem.market_value !== 'undefined') {
        next[item.itemId] = Number(apiItem.market_value);
      }
    }

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
    const cutoff = now() - SEEN_TTL_MS;
    for (const key of Object.keys(map)) {
      if (map[key] < cutoff) delete map[key];
    }
    return map;
  }

  function extractListingIdentity(listing) {
    const candidates = [
      listing?.ID,
      listing?.id,
      listing?.listingID,
      listing?.listingId,
      listing?.itemmarketid,
      listing?.itemMarketId,
      listing?.item_id,
      listing?.itemID,
      listing?.UID,
      listing?.uid,
      listing?.uniqueId,
      listing?.uniqueID,
      listing?.lotID,
      listing?.lotId
    ];

    for (const candidate of candidates) {
      if (candidate !== null && typeof candidate !== 'undefined' && String(candidate).trim() !== '') {
        return String(candidate).trim();
      }
    }

    return '';
  }

  function makeFingerprint(itemRule, listing) {
    const listingIdentity = extractListingIdentity(listing);
    if (listingIdentity) {
      return `${itemRule.itemId}|listing:${listingIdentity}`;
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
    const sample = (Array.isArray(listings) ? listings : []).slice(0, 5).map(listing => {
      const id = listing?.ID ?? listing?.id ?? listing?.listingID ?? listing?.listingId ?? 'na';
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
    if (price <= 0) return false;

    const rawMinArmor = String(itemRule.minArmor ?? '').trim();
    if (rawMinArmor) {
      const minArmor = Math.max(1, Math.floor(Number(rawMinArmor) || 0));
      const actualArmor = extractArmor(listing);

      if (!Number.isFinite(actualArmor)) return false;
      if (actualArmor < minArmor) return false;
    }

    const rawMinQuality = String(itemRule.minQuality ?? '').trim();
    if (rawMinQuality) {
      const minQuality = Math.max(1, Math.floor(Number(rawMinQuality) || 0));
      const actualQuality = extractQuality(listing);

      if (!Number.isFinite(actualQuality)) return false;
      if (actualQuality < minQuality) return false;
    }

    if (itemRule.useMV) {
      const mv = Number(marketValues[itemRule.itemId] || 0);
      if (!mv) return false;

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
      parts.push(`Sell ~$${armorEstimate.sellPrice.toLocaleString()}`);
      parts.push(`Net ~$${armorEstimate.netProfit.toLocaleString()}`);
      parts.push(armorEstimate.bracketLabel);

      if (armorEstimate.usedFallback) {
        parts.push('rough');
      }
    } else if (diffPct !== null) {
      parts.push(`${diffPct.toFixed(1)}%`);
    }

    if (velocityInfo && velocityInfo.samples >= 3) {
      parts.push(`${velocityInfo.label} ${velocityInfo.pct}%`);
    }

    return {
      text: parts.join(' | '),
      diffPct,
      tier: getTier(diffPct ?? 0, !!itemRule.useMV)
    };
  }

  async function scanWatchItem(itemRule, marketValues) {
    const pagesToScan = Math.min(5, Math.max(1, Math.floor(Number(itemRule.pagesToScan) || 1)));
    let listings = [];
    let lastPageHitCount = 0;
    let actualPagesScanned = 0;
    const pageDetails = [];

    for (let page = 0; page < pagesToScan; page++) {
      const data = await fetchItemMarket(itemRule.itemId, page);

      const pageListings = extractListings(data)
        .filter(l => extractPrice(l) > 0);

      actualPagesScanned += 1;
      lastPageHitCount = pageListings.length;
      listings.push(...pageListings);

      pageDetails.push({
        page: page + 1,
        count: pageListings.length,
        signature: buildPageVerificationSignature(pageListings)
      });

      if (pageListings.length < 100) break;
    }

    listings = listings.sort((a, b) => extractPrice(a) - extractPrice(b));

    const signature = buildVelocitySignature(listings);
    const velocity = updateVelocityForItem(itemRule.itemId, signature);
    const pageVerification = buildPageVerificationSummary(pageDetails);

    for (const listing of listings) {
      if (listingMatchesRule(itemRule, listing, marketValues)) {
        const matchedSignature = buildVelocitySignature(listings, listing);

        return {
          itemRule,
          listing,
          listings,
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
    const formatted = formatMatchText(match, marketValues);
    const url = buildMarketUrl(itemRule.itemId);
    const fingerprint = String(match?.fingerprint || '').trim();
    return {
      itemRule,
      formatted,
      url,
      fingerprint
    };
  }

  function shouldDispatchAlert(match, payload, seenMap, settings) {
    const fingerprint = String(payload?.fingerprint || '').trim();
    const cooldownMs = Number(settings?.alertCooldownMs || 0);
    const tsNow = now();

    if (fingerprint) {
      const lastSeenAt = Number(seenMap?.[fingerprint] || 0);
      if (lastSeenAt && (tsNow - lastSeenAt) < cooldownMs) {
        return {
          shouldAlert: false,
          reason: 'cooldown',
          tsNow
        };
      }
    }

    if (shouldSuppressPopupAlert(match, payload?.formatted, payload?.url)) {
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
    const tsNow = Number(decision?.tsNow || now());

    if (fingerprint) {
      seenMap[fingerprint] = tsNow;
    }

    addPopupHistoryEntry({
      itemId: payload?.itemRule?.itemId,
      itemName: payload?.itemRule?.displayName,
      text: payload?.formatted?.text,
      tier: payload?.formatted?.tier,
      fingerprint,
      url: payload?.url
    });

    setLastAlert(`${payload?.itemRule?.displayName || 'Unknown item'} | ${payload?.formatted?.text || ''}`);
  }

  function notifyWatchItemHit(match, payload) {
  const itemRule = payload?.itemRule || match?.itemRule || {};
  const formatted = payload?.formatted || formatMatchText(match, {});
  const url = payload?.url || buildMarketUrl(itemRule.itemId);

  showToast(itemRule.displayName, formatted.text, formatted.tier, () => {
    location.href = url;
  });

  showDesktopNotification(itemRule.displayName, formatted.text, url);
  return true;
}
  function getLeaderInfo() {
    return {
      id: localStorage.getItem(LOCK_KEY) || '',
      beat: getNumber(LOCK_HEARTBEAT_KEY, 0)
    };
  }

  function tryBecomeLeader() {
    const { id, beat } = getLeaderInfo();
    const stale = !id || (now() - beat > LOCK_TIMEOUT_MS);

    if (stale || id === TAB_ID) {
      localStorage.setItem(LOCK_KEY, TAB_ID);
      isLeader = true;
      setNumber(LOCK_HEARTBEAT_KEY, now());
      return true;
    }

    isLeader = false;
    return false;
  }

  function maintainLeadership() {
    const { id, beat } = getLeaderInfo();
    const stale = !id || (now() - beat > LOCK_TIMEOUT_MS);

    if (id === TAB_ID || stale) {
      localStorage.setItem(LOCK_KEY, TAB_ID);
      setNumber(LOCK_HEARTBEAT_KEY, now());

      if (!isLeader) {
        isLeader = true;
        if (isEnabled()) runLoop();
      }
    } else {
      isLeader = false;
    }

    updateBadge();
    requestDebugPanelRefresh();
  }

  function releaseLeadership() {
    const { id } = getLeaderInfo();
    if (id === TAB_ID) {
      localStorage.setItem(LOCK_KEY, '');
      setNumber(LOCK_HEARTBEAT_KEY, 0);
    }
  }

  async function runLoop() {
    if (!isLeader || isRunningLoop || !isEnabled()) return;

    isRunningLoop = true;
    setNumber(STORAGE_KEYS.lastScanAt, now());
    requestDebugPanelRefresh();

    try {
      const settings = getSettings();
      const watchlist = getWatchlist();
      const marketValues = await refreshMarketValuesIfNeeded();
      let seenMap = loadSeenMap();
      seenMap = pruneSeenMap(seenMap);

      for (const itemRule of watchlist) {
        if (!isLeader || !isEnabled() || !isMembershipActive()) break;
        if (!itemRule.enabled) continue;

        try {
          const result = await scanWatchItem(itemRule, marketValues);

          setScanStatus(itemRule.itemId, {
            ok: true,
            matchFound: !!(result && result.listing),
            pagesScanned: Number(result?.pagesScanned || 0),
            pagesRequested: Number(result?.pagesRequested || itemRule.pagesToScan || 1),
            listingsScanned: Array.isArray(result?.listings) ? result.listings.length : 0,
            pageDetails: Array.isArray(result?.pageDetails) ? result.pageDetails : [],
            duplicatePageData: !!result?.duplicatePageData,
            uniquePageSignatures: Number(result?.uniquePageSignatures || 0),
            errorMessage: ''
          });

          if (result && result.listing) {
            const payload = buildAlertPayload(result, marketValues);
            const decision = shouldDispatchAlert(result, payload, seenMap, settings);

            if (decision.shouldAlert) {
              recordAlertDispatch(result, payload, seenMap, decision);
              notifyWatchItemHit(result, payload);
            }
          }
        } catch (err) {
          const message = `${err.message || err}`;
          setScanStatus(itemRule.itemId, {
            ok: false,
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

      saveSeenMap(seenMap);
      requestDebugPanelRefresh();
    } catch (err) {
      setLastError(err.message || String(err));
    } finally {
      isRunningLoop = false;
    }
  }

  async function waitForBody() {
    while (!document.body) {
      await sleep(50);
    }
  }

  async function init() {
    await waitForBody();

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
    window.addEventListener('pagehide', releaseLeadership);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init().catch(err => setLastError(err.message || String(err)));
    });
  } else {
    init().catch(err => setLastError(err.message || String(err)));
  }
})();
