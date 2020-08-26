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

describe("LidSimplifiedPresale", function() {
  before(async function() {
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
      // config.presale.token,
      this.Token.address,
      config.presale.uniswapRouter,
      config.presale.lidFund
    );
    await this.Token.transfer(this.Presale.address, TOTAL_TOKENS, {
      from: initialTokenHolder,
    });
    this.Presale.setTokenPools(
      config.presale.uniswapTokenBP,
      config.presale.presaleTokenBP,
      [this.DaoLock.address, this.TeamLock.address, projectFund],
      [
        config.presale.tokenDistributionBP.dao,
        config.presale.tokenDistributionBP.marketing,
        config.presale.tokenDistributionBP.team,
      ]
    );
  });

  describe("Stateless", function() {
    describe("setWhitelist", async function() {
      it("should revert for non-owner", async function() {
        await expectRevert(
          this.Presale.setWhitelist(depositors[0], true, {
            from: depositors[0],
          }),
          "Ownable: caller is not the owner"
        );
      });

      it("should whitelist non whitelisted account", async function() {
        const whitelist = await this.Presale.whitelist(depositors[0]);
        await this.Presale.setWhitelist(depositors[0], true, {
          from: owner,
        });
        expect(whitelist).to.equal(false);
        expect(await this.Presale.whitelist(depositors[0])).to.equal(true);
      });
      it("should unwhitelist account", async function() {
        const whitelist = await this.Presale.whitelist(depositors[0]);
        await this.Presale.setWhitelist(depositors[0], false, {
          from: owner,
        });
        expect(whitelist).to.equal(true);
        expect(await this.Presale.whitelist(depositors[0])).to.equal(false);
      });
    });

    describe("#setWhitelistForAll", function() {
      it("should whitelist all addresses", async function() {
        await this.Presale.setWhitelistForAll(depositors, true, {
          from: owner,
        });
        let whitelistVals = await Promise.all(
          depositors.map((depositor) => {
            return this.Presale.whitelist(depositor);
          })
        );
        expect(
          whitelistVals.reduce((acc, val) => {
            return acc && val;
          })
        ).to.equal(true);
      });
    });
  });

  describe("State: Before Presale Start", function() {
    before(async function() {
      const startTime = await this.Timer.startTime();
    });
    describe("#deposit", function() {
      it("should revert", async function() {
        await expectRevert(
          this.Presale.deposit({ from: depositors[0] }),
          "Presale not yet started."
        );
      });
    });
    describe("#sendToUniswap", function() {
      it("should revert", async function() {
        await expectRevert(
          this.Presale.sendToUniswap({ from: depositors[0] }),
          "Presale not yet started."
        );
      });
    });
  });

  describe("State: Presale Active", function() {
    before(async function() {
      await this.Timer.initialize(
        config.timer.startTime,
        config.timer.hardCapTimer,
        config.timer.softCap,
        this.Presale.address,
        owner
      );
      await this.Timer.setStartTime(
        (Math.floor(Date.now() / 1000) - 60).toString(),
        { from: owner }
      );
    });
    describe("#sendToUniswap", function() {
      it("should revert", async function() {
        await expectRevert(
          this.Presale.sendToUniswap({ from: depositors[0] }),
          "Presale has not yet ended."
        );
      });
    });
    // Todo: Isaac, resolve the out of gas error
    // describe("#deposit", function() {
    //   it("should not allow more than nonWhitelisted max buy if not on whitelist.", async function() {
    //     const result = await this.Presale.deposit({
    //       from: accounts[5],
    //       value: config.presale.maxBuyWithoutWhitelisting.add(new BN(20)),
    //     });
    //     await expectRevert(
    //       result,
    //       "Deposit exceeds max buy per address for non-whitelisted addresses."
    //     );
    //   });
    //   it("should revert if buy higher than max", async function() {
    //     const totalDeposit = await web3.eth.getBalance(this.Presale.address);
    //     const max = new BN(
    //       await this.Presale.getMaxWhitelistedDeposit(totalDeposit)
    //     );

    //     await expectRevert(
    //       this.Presale.deposit({
    //         from: depositors[0],
    //         value: max.add(new BN(1)),
    //       }),
    //       "Deposit exceeds max buy per address for whitelisted addresses."
    //     );
    //     await expectRevert(
    //       this.Presale.deposit({
    //         from: depositors[0],
    //         value: max.add(ether("1")),
    //       }),
    //       "Deposit exceeds max buy per address for whitelisted addresses."
    //     );
    //   });
    //   describe("On buyer1 success", function() {
    //     before(async function() {
    //       this.Presale.deposit({
    //         from: depositors[0],
    //         value: config.presale.maxBuyPerAddress,
    //       });
    //     });
    //   });
    //   describe("On buyer2 success", function() {
    //     before(async function() {
    //       this.Presale.deposit({
    //         from: depositors[1],
    //         value: config.presale.maxBuyPerAddress,
    //       });
    //     });
    //   });
    //   describe("On final buyer attempts", function() {
    //     it("should revert if greater than max", async function() {
    //       const totalDeposit = await web3.eth.getBalance(this.Presale.address);
    //       const max = new BN(
    //         await this.Presale.getMaxWhitelistedDeposit(totalDeposit)
    //       );

    //       await expectRevert(
    //         this.Presale.deposit({
    //           from: depositors[2],
    //           value: max.add(new BN(1)),
    //         }),
    //         "Deposit exceeds max buy per address for whitelisted addresses."
    //       );
    //     });
    //     it("should revert if time is after endtime.", async function() {
    //       const totalDeposit = await web3.eth.getBalance(this.Presale.address);
    //       const max = new BN(
    //         await this.Presale.getMaxWhitelistedDeposit(totalDeposit)
    //       );
    //       await this.Timer.setEndTime(new Date.now(), { from: owner });

    //       const result = await this.Presale.deposit({
    //         from: depositors[2],
    //         value: max,
    //       });

    //       await expectRevert(result, "Presale has ended.");
    //     });
    //   });
    // });
  });

  describe("State: Presale Ended", function() {
    before(async function() {
      await this.Timer.setStartTime(
        (Math.floor(Date.now() / 1000) - 60).toString(),
        { from: owner }
      );
    });
    describe("#deposit", function() {
      it("should revert", async function() {
        const result = await this.Presale.deposit({ from: depositors[0] });
        expectRevert(result, "Presale has ended.");
      });
    });
  });
});
