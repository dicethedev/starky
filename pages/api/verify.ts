import type { NextApiRequest, NextApiResponse } from "next";
import { typedData } from "starknet";
import { refreshDiscordMember } from "../../cron";
import { DiscordMemberRepository, setupDb } from "../../db";
import messageToSign from "../../starknet/message";
import { verifySignature } from "../../starknet/verifySignature";
import { DiscordServerConfigRepository } from "../../db/index";

type Data = {
  message: string;
};

const handler = async (req: NextApiRequest, res: NextApiResponse<Data>) => {
  await setupDb();
  if (req.method !== "POST") {
    res.status(405).json({ message: "Only POST allowed" });
    return;
  }
  const body = req.body;
  if (
    !body.account ||
    !body.signature ||
    !body.discordServerId ||
    !body.discordMemberId ||
    !body.customLink ||
    !body.network
  ) {
    res.status(400).json({
      message:
        "Missing body: account, signature, DiscordServerId, discordMemberId, customLink & network required",
    });
    return;
  }

  const discordMembers = await DiscordMemberRepository.find({
    where: {
      discordServerId: body.discordServerId,
      discordMemberId: body.discordMemberId,
      starknetNetwork: body.network,
    },
    relations: ["DiscordServer"],
  });

  const discordConfigs = await DiscordServerConfigRepository.findBy({
    discordServerId: discordMembers[0].discordServerId,
  });

  for (let discordMember of discordMembers) {
    if (!discordMember || discordMember.customLink !== body.customLink) {
      res.status(400).json({
        message: "Wrong custom link",
      });
      return;
    }

    const messageHexHash = typedData.getMessageHash(
      messageToSign,
      body.account
    );
    const signatureVerified = await verifySignature(
      body.account,
      messageHexHash,
      body.signature,
      body.network
    );
    if (!signatureVerified) {
      return res.status(400).json({ message: "Signature is invalid" });
    } else {
      discordMember.starknetWalletAddress = body.account;

      res.status(200).json({ message: "Successfully verified" });
      // Let's refresh its status immediatly
      DiscordMemberRepository.save(discordMembers);

      for (let discordMember of discordMembers) {
        for (let discordConfig of discordConfigs) {
          refreshDiscordMember(discordConfig, discordMember, body.network);
        }
      }
    }
  }
};

export default handler;
