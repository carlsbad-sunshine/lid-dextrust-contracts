const { accounts, contract, web3 } = require("@openzeppelin/test-environment");
const {
  expectRevert,
  time,
  BN,
  ether,
  balance,
} = require("@openzeppelin/test-helpers");
const { expect } = require("chai");
const config = require("../config");

const Token = contract.fromArtifact("Token");
const TeamLock = contract.fromArtifact("LidTimeLock");
const DaoLock = contract.fromArtifact("LidTimeLock");
const LidSimplifiedPresale = contract.fromArtifact("LidSimplifiedPresale");
const LidSimplifiedPresaleRedeemer = contract.fromArtifact(
  "LidSimplifiedPresaleRedeemer"
);
const LidSimplifiedPresaleTimer = contract.fromArtifact(
  "LidSimplifiedPresaleTimer"
);

const owner = accounts[0];
const depositors = [
  accounts[1],
  accounts[2],
  accounts[3],
  accounts[4],
  accounts[5],
];
const projectFund = accounts[6];
const teamFund = accounts[7];
const initialTokenHolder = accounts[8];

const TOTAL_TOKENS = ether("100000000");
const SECONDS_PER_HOUR = 3600;

describe("LidSimplifiedPresale", function () {
  before(async function () {
    this.Token = await Token.new();
    this.TeamLock = await TeamLock.new();
    this.DaoLock = await DaoLock.new();
    this.Presale = await LidSimplifiedPresale.new();
    this.Redeemer = await LidSimplifiedPresaleRedeemer.new();
    this.Timer = await LidSimplifiedPresaleTimer.new();

    await this.Token.initialize(TOTAL_TOKENS, initialTokenHolder);
    await this.Redeemer.initialize(
      config.redeemer.redeemBP,
      config.redeemer.redeemInterval,
      config.redeemer.bonusRangeStart,
      config.redeemer.bonusRangeBP,
      this.Presale.address,
      owner
    );
    await this.Timer.initialize(
      config.timer.startTime,
      config.timer.hardCapTimer,
      config.timer.softCap,
      this.Presale.address,
      owner
    );
    await this.Presale.initialize(
      config.presale.maxBuyPerAddress,
      config.presale.maxBuyWithoutWhitelisting,
      config.presale.uniswapEthBP,
      config.presale.lidEthBP,
      config.presale.referralBP,
      config.presale.hardcap,
      owner,
      this.Timer.address,
      this.Redeemer.address,
      config.presale.token,
      config.presale.uniswapRouter,
      config.presale.lidFund
    );
    await this.Token.transfer(this.Presale.address, TOTAL_TOKENS, {
      from: initialTokenHolder,
    });
    await this.Presale.setTokenPools(
      config.Presale.uniswapTokenBP,
      config.Presale.presaleTokenBP,
      [this.DaoLock.address, this.TeamLock.address, this.projectFund.address],
      config.Presale.tokenDistributionBP
    );
  });

  describe("Stateless", function () {
    describe("setWhitelist", async function () {
      it("should revert for non-owner", async function () {
        await expectRevert(
          this.Presale.setWhitelist(depositors[0], true, {
            from: depositors[0],
          }),
          "Ownable: caller is not the owner"
        );
      });

      it("should whitelist non whitelisted account", async function () {
        const whitelist = await this.Presale.whitelist(depositors[0]);
        await this.Presale.setWhitelist(depositors[0], true, {
          from: owner,
        });
        expect(whitelist).to.equal(false);
        expect(await this.Presale.whitelist(depositors[0])).to.equal(true);
      });
      it("should unwhitelist account", async function () {
        const whitelist = await this.Presale.whitelist(depositors[0]);
        await this.Presale.setWhitelist(depositors[0], false, {
          from: owner,
        });
        expect(whitelist).to.equal(true);
        expect(await this.Presale.whitelist(depositors[0])).to.equal(false);
      });
    });
  });

  describe("State: Before Presale Start", function () {
    before(async function () {
      await this.Timer.setStartTime(
        (Math.floor(Date.now() / 1000) - 60).toString(),
        { from: owner }
      );
    });
    describe("#sendToUniswap", function () {
      it("should revert", async function () {
        await expectRevert(
          this.Presale.sendToUniswap({ from: depositors[0] }),
          "Presale not yet started."
        );
      });
    });
    describe("#deposit", function () {
      it("should revert", async function () {
        await expectRevert(
          this.Presale.deposit({ from: depositors[0] }),
          "Presale not yet started."
        );
      });
    });
  });

  describe("State: Presale Active", function () {
    describe("deposit", function () {
      it("should fail if less than 0.01 eth", async function () {
        await expectRevert(
          this.Presale.deposit({ from: depositors[0], value: "0" }),
          "Must purchase at least 0.01 ether."
        );
      });
      it("should not allow more than nonWhitelisted max buy if not on whitelist.", async function () {
        await expectRevert(
          this.Presale.deposit({
            from: notWhitelisted,
            value: config.LidPresale.maxBuyWithoutWhitelisting.add(new BN(1)),
          }),
          "Deposit exceeds max buy per address for non-whitelisted addresses."
        );
      });
      it("should revert if buy higher than max", async function () {
        const totalDeposit = await web3.eth.getBalance(this.Presale.address);
        const max = new BN(
          await this.Presale.getMaxWhitelistedDeposit(totalDeposit)
        );

        await expectRevert(
          this.Presale.deposit({
            from: depositors[0],
            value: max.add(new BN(1)),
          }),
          "Deposit exceeds max buy per address for whitelisted addresses."
        );
        await expectRevert(
          this.Presale.deposit({
            from: depositors[0],
            value: max.add(ether("10000000000000")),
          }),
          "Deposit exceeds max buy per address for whitelisted addresses."
        );
      });
    });

    describe("First depositor succeed", function () {
      before(async function () {
        this.Presale.deposit({
          from: depositors[0],
          value: config.Presale.maxBuyPerAddress,
        });
      });
    });
    describe("Second depositor succeed", function () {
      before(async function () {
        this.Presale.deposit({
          from: depositors[1],
          value: config.Presale.maxBuyPerAddress,
        });
      });
    });
  });

  describe("State: Presale Ended", function () {
    describe("#deposit", function () {
      it("should revert", async function () {
        await expectRevert(
          this.Presale.deposit({ from: depositors[0] }),
          "Presale has ended."
        );
      });
    });
  });
});
